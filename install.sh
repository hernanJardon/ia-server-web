#!/usr/bin/env bash
# Instala el Panel IA Server como servicio systemd en la misma máquina que Ollama.
#
#   sudo ./install.sh              instala o actualiza el panel
#   sudo ./install.sh --llama-cpp  además compila llama-quantize y llama-server (cuantizar y motor llama.cpp)
#   sudo ./install.sh --train      además prepara PyTorch + PEFT para entrenar LoRA (incluye --llama-cpp)
#   sudo ./install.sh --vllm       además instala vLLM en su propio entorno (motor con paralelismo de tensor)
#   sudo ./install.sh --remove     desinstala el servicio (conserva datos en /var/lib/ollama-panel)
#
# Variables opcionales: PANEL_PORT (8080), PANEL_USER (el usuario que ejecutó sudo).
set -euo pipefail

APP_DIR=/opt/ollama-panel
DATA_DIR=/var/lib/ollama-panel
ENV_FILE=/etc/ollama-panel.env
UNIT=/etc/systemd/system/ollama-panel.service
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_USER="${PANEL_USER:-${SUDO_USER:-}}"
PANEL_PORT="${PANEL_PORT:-8080}"

die() { echo "Error: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "ejecútalo con sudo."

# En Debian/Ubuntu, "python3 -m venv" existe siempre pero no puede crear entornos sin ensurepip,
# que viene en python3.X-venv. Se instala si falta.
ensure_venv() {
  python3 -c "import ensurepip" >/dev/null 2>&1 && return 0
  local pyver; pyver="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  if command -v apt-get >/dev/null; then
    echo "== Instalando python${pyver}-venv (necesario para crear entornos de Python)"
    apt-get install -y "python${pyver}-venv" || apt-get install -y python3-venv || die "no se pudo instalar python${pyver}-venv."
  fi
  python3 -c "import ensurepip" >/dev/null 2>&1 || die "falta ensurepip: instala python${pyver}-venv y repite."
}

WANT_TRAIN=0; WANT_LLAMA=0; WANT_REMOVE=0; WANT_VLLM=0
for arg in "$@"; do
  case "$arg" in
    --train) WANT_TRAIN=1; WANT_LLAMA=1 ;;
    --vllm) WANT_VLLM=1 ;;
    --llama-cpp) WANT_LLAMA=1 ;;
    --remove) WANT_REMOVE=1 ;;
    *) die "opción desconocida: $arg" ;;
  esac
done

if [ "$WANT_REMOVE" = 1 ]; then
  systemctl disable --now ollama-panel 2>/dev/null || true
  rm -f "$UNIT" "$ENV_FILE"
  rm -rf "$APP_DIR"
  systemctl daemon-reload
  echo "Servicio eliminado. Los datos (datasets, trabajos, entorno) siguen en $DATA_DIR."
  exit 0
fi

[ -n "$PANEL_USER" ] && [ "$PANEL_USER" != root ] || die "no se pudo deducir el usuario. Usa: sudo PANEL_USER=tu_usuario ./install.sh"
id "$PANEL_USER" >/dev/null 2>&1 || die "el usuario $PANEL_USER no existe."
command -v python3 >/dev/null || die "falta python3 (sudo apt install python3)."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' || die "se necesita Python 3.8 o superior."
command -v ollama >/dev/null || echo "Aviso: no encuentro el comando ollama en el PATH; el panel espera la API en 127.0.0.1:11434."

mkdir -p "$DATA_DIR"
chown "$PANEL_USER": "$DATA_DIR"

# La app instalada es un clon de git del repositorio, propiedad del usuario del servicio:
# así el panel puede actualizarse solo desde GitHub (git pull y reinicio).
REPO_URL="$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null || true)"
[ -n "$REPO_URL" ] || REPO_URL="https://github.com/hernanJardon/ia-server-web.git"
command -v git >/dev/null || die "falta git (sudo apt install git)."
if [ -d "$APP_DIR/.git" ]; then
  echo "== Actualizando $APP_DIR desde $REPO_URL"
  chown -R "$PANEL_USER": "$APP_DIR"
  sudo -u "$PANEL_USER" -H git -C "$APP_DIR" pull --ff-only
else
  echo "== Clonando $REPO_URL en $APP_DIR"
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  chown "$PANEL_USER": "$APP_DIR"
  sudo -u "$PANEL_USER" -H git clone --quiet "$REPO_URL" "$APP_DIR"
fi

# Leer los logs de Ollama con journalctl, y los archivos GGUF de los modelos para cuantizarlos
if getent group systemd-journal >/dev/null; then usermod -aG systemd-journal "$PANEL_USER"; fi
if getent group ollama >/dev/null; then usermod -aG ollama "$PANEL_USER"; fi

if [ ! -f "$ENV_FILE" ]; then
  echo
  echo "El panel puede borrar modelos y lanzar entrenamientos. Conviene protegerlo con contraseña."
  read -r -s -p "Contraseña del panel (vacía = sin contraseña): " PASS; echo
  umask 077
  cat > "$ENV_FILE" <<EOF
OLLAMA_URL=http://127.0.0.1:11434
PANEL_HOST=0.0.0.0
PANEL_PORT=$PANEL_PORT
PANEL_DATA=$DATA_DIR
PANEL_PASSWORD=$PASS
# HTTPS (necesario si te conectas desde fuera sin VPN): certificado y clave en PEM
# PANEL_TLS_CERT=/etc/ollama-panel/cert.pem
# PANEL_TLS_KEY=/etc/ollama-panel/key.pem
EOF
  chown root:"$PANEL_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
fi

if [ "$WANT_LLAMA" = 1 ]; then
  for tool in git cmake g++; do command -v "$tool" >/dev/null || die "falta $tool (sudo apt install git cmake build-essential)."; done
  NVCC="$(command -v nvcc || true)"
  [ -z "$NVCC" ] && [ -x /usr/local/cuda/bin/nvcc ] && NVCC=/usr/local/cuda/bin/nvcc
  if [ -n "$NVCC" ]; then
    CUDA_FLAG="-DGGML_CUDA=ON -DCMAKE_CUDA_COMPILER=$NVCC"
    echo "== Compilando llama.cpp con CUDA ($NVCC): llama-quantize y llama-server. Tarda 10-20 minutos."
  else
    CUDA_FLAG="-DGGML_CUDA=OFF"
    echo "== Aviso: no encuentro nvcc (CUDA Toolkit). llama-server se compilará solo para CPU."
    echo "   Para servir modelos en las GPU con llama.cpp: sudo apt install nvidia-cuda-toolkit y repite --llama-cpp."
  fi
  sudo -u "$PANEL_USER" -H bash -euo pipefail <<EOF
cd "$DATA_DIR"
if [ ! -d llama.cpp ]; then git clone --depth 1 https://github.com/ggml-org/llama.cpp.git; else git -C llama.cpp pull --ff-only || true; fi
cd llama.cpp
cmake -B build $CUDA_FLAG -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build --target llama-quantize llama-server -j "\$(nproc)"
EOF
  grep -q '^LLAMA_CPP_DIR=' "$ENV_FILE" || echo "LLAMA_CPP_DIR=$DATA_DIR/llama.cpp" >> "$ENV_FILE"
fi

if [ "$WANT_TRAIN" = 1 ]; then
  echo "== Preparando el entorno de entrenamiento en $DATA_DIR/venv (varios GB, tarda unos minutos)"
  ensure_venv
  sudo -u "$PANEL_USER" -H bash -euo pipefail <<EOF
cd "$DATA_DIR"
# Un entorno sin pip quedó a medias en un intento anterior: se rehace.
[ -x venv/bin/pip ] || { rm -rf venv; python3 -m venv venv; }
venv/bin/pip install --upgrade pip
venv/bin/pip install torch transformers peft accelerate bitsandbytes safetensors sentencepiece protobuf
venv/bin/pip install ./llama.cpp/gguf-py
EOF
  grep -q '^TRAIN_PYTHON=' "$ENV_FILE" || echo "TRAIN_PYTHON=$DATA_DIR/venv/bin/python" >> "$ENV_FILE"
fi

if [ "$WANT_VLLM" = 1 ]; then
  echo "== Instalando vLLM en $DATA_DIR/vllm-venv (entorno propio: trae su versión de PyTorch; varios GB)"
  ensure_venv
  sudo -u "$PANEL_USER" -H bash -euo pipefail <<EOF
cd "$DATA_DIR"
[ -x vllm-venv/bin/pip ] || { rm -rf vllm-venv; python3 -m venv vllm-venv; }
vllm-venv/bin/pip install --upgrade pip
vllm-venv/bin/pip install vllm
EOF
  grep -q '^VLLM_PYTHON=' "$ENV_FILE" || echo "VLLM_PYTHON=$DATA_DIR/vllm-venv/bin/python" >> "$ENV_FILE"
  grep -q '^HF_TOKEN=' "$ENV_FILE" || echo "# HF_TOKEN=hf_...   (solo para modelos de Hugging Face con acceso restringido)" >> "$ENV_FILE"
fi

echo "== Creando el servicio systemd"
cat > "$UNIT" <<EOF
[Unit]
Description=Panel web de Ollama
After=network-online.target ollama.service
Wants=network-online.target

[Service]
User=$PANEL_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env python3 $APP_DIR/server.py
# on-failure también relanza el panel cuando sale a propósito tras actualizarse (código 3)
Restart=on-failure
RestartSec=3
# Las instancias de llama-server que lanza el panel se cierran con él
KillMode=control-group

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ollama-panel >/dev/null
systemctl restart ollama-panel
sleep 1
systemctl --no-pager --lines=3 status ollama-panel || true

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Listo: http://${IP:-<ip-del-servidor>}:$PANEL_PORT"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "ufw está activo; para abrir el puerto en la red local: sudo ufw allow from ${IP%.*}.0/24 to any port $PANEL_PORT"
fi
