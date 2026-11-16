# Panel Ollama

Panel web para administrar un servidor [Ollama](https://ollama.com) sin entrar por SSH. Se instala en la misma máquina Linux que Ollama y se usa desde el navegador de cualquier equipo de la red local.

## Qué hace

| Sección | Para qué |
|---|---|
| **Modelos** | Memoria de cada GPU y qué modelo la ocupa, modelos en memoria con su caducidad, y la lista de instalados con un veredicto de cabida en VRAM. La ficha de cada modelo muestra sus metadatos y permite cargarlo en memoria (tiempo de permanencia y contexto), descargarlo de memoria, copiarlo o borrarlo. |
| **Motores** | Sirve un modelo fuera de Ollama eligiendo **en qué GPU** va, con su propia API compatible con OpenAI en un puerto (8090 en adelante). **llama.cpp** (`llama-server`) usa el GGUF que Ollama ya tiene descargado. **vLLM** descarga el modelo de Hugging Face y lo reparte con paralelismo de tensor entre 1, 2 o 4 GPU. Las instancias se prueban desde el Chat de prueba. |
| **Descargar** | `ollama pull` del registro de Ollama o de un GGUF de Hugging Face (`hf.co/usuario/repo:Q4_K_M`), con progreso y cancelación. |
| **Subir GGUF** | Sube un archivo `.gguf` desde tu PC y crea el modelo en Ollama. |
| **Cuantizar** | Recuantiza un modelo instalado a cualquier tipo de llama.cpp (Q2_K … Q8_0, IQ4_XS, F16) conservando plantilla, prompt de sistema y parámetros. |
| **Crear variante** | Un modelo nuevo sobre los pesos de otro con su propio `SYSTEM`, parámetros y plantilla (sin ocupar disco extra). |
| **Chat de prueba** | Conversación rápida para comprobar un modelo, con razonamiento visible e imágenes si el modelo las admite. |
| **Entrenamiento** | Fine-tuning LoRA/QLoRA con PyTorch sobre el modelo original de Hugging Face, validación de datasets `.jsonl` y registro del adaptador en Ollama. |
| **Registros** | `journalctl -u ollama`, con actualización automática. |

## Instalación

En el servidor, con Python 3.8 o superior (sin dependencias para el panel en sí):

```bash
git clone https://github.com/hernanJardon/ia-server-web.git
cd ia-server-web
sudo ./install.sh                # solo el panel
sudo ./install.sh --llama-cpp    # + llama-quantize y llama-server: Cuantizar y el motor llama.cpp
sudo ./install.sh --train        # + PyTorch/PEFT para Entrenamiento (incluye --llama-cpp)
sudo ./install.sh --vllm         # + vLLM como motor (entorno propio)
```

Las opciones se pueden combinar (`sudo ./install.sh --train --vllm`).

El instalador copia el panel a `/opt/ollama-panel`, guarda los datos en `/var/lib/ollama-panel`, pide una contraseña opcional y crea el servicio `ollama-panel`. Después abre `http://IP-DEL-SERVIDOR:8080`.

- `--llama-cpp` necesita `git`, `cmake` y `build-essential`. Para que `llama-server` use las GPU hace falta además el CUDA Toolkit (`nvcc`, paquete `nvidia-cuda-toolkit`); sin él se compila solo para CPU y el panel lo avisa.
- `--vllm` instala vLLM en `/var/lib/ollama-panel/vllm-venv`. Con GPU de 12 GB, los modelos de más de 7B necesitan versiones cuantizadas en AWQ o GPTQ (por ejemplo `Qwen/Qwen2.5-14B-Instruct-AWQ` en 2 GPU). Para modelos con acceso restringido, añade `HF_TOKEN` a `/etc/ollama-panel.env`.
- `--train` descarga varios GB (PyTorch con CUDA) y necesita `python3-venv`.
- Para actualizar, `git pull` y vuelve a ejecutar `sudo ./install.sh` con las mismas opciones.
- Para desinstalar: `sudo ./install.sh --remove` (los datos se conservan).

La configuración está en `/etc/ollama-panel.env`; tras cambiarla, `sudo systemctl restart ollama-panel`.

| Variable | Por defecto | |
|---|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | API de Ollama |
| `PANEL_HOST` / `PANEL_PORT` | `0.0.0.0` / `8080` | Dónde escucha el panel |
| `PANEL_PASSWORD` | vacía | Si se define, el navegador la pide (HTTP Basic, cualquier usuario) |
| `PANEL_DATA` | `/var/lib/ollama-panel` | Datasets, trabajos y entornos |
| `TRAIN_PYTHON` | `$PANEL_DATA/venv/bin/python` | Intérprete con torch y peft |
| `LLAMA_CPP_DIR` | `$PANEL_DATA/llama.cpp` | Para `llama-quantize` y la conversión de adaptadores |

## Seguridad

El panel puede borrar modelos y lanzar procesos. Ponle contraseña y no lo expongas fuera de tu red. La contraseña viaja en claro por HTTP; si accedes desde fuera, usa una VPN o un proxy con HTTPS delante. Las peticiones que modifican algo se rechazan si vienen de otra web abierta en el navegador (comprobación de `Origin`).

## Cómo funciona

- `server.py` sirve la interfaz y hace de proxy de `/api/*` de Ollama en `/ollama/*`, con streaming, de modo que el progreso de descargas y respuestas llega en directo. Cancelar en el navegador corta también la operación en Ollama.
- La ocupación por GPU sale de `nvidia-smi`. Para saber qué modelo ocupa cada tarjeta, el panel cruza los procesos de `nvidia-smi` con el GGUF que carga cada `ollama runner`.
- El veredicto de cabida suma pesos + caché KV (capas con atención × cabezas KV × dimensiones × contexto) × peticiones en paralelo + el estado recurrente de los modelos híbridos + búferes, y reparte entre tarjetas reservando 0,6 GiB en cada una. El contexto, el paralelismo y el tipo de caché salen de `OLLAMA_CONTEXT_LENGTH`, `OLLAMA_NUM_PARALLEL` y `OLLAMA_KV_CACHE_TYPE` del servicio de Ollama. Si no están definidas, se deducen de los modelos cargados, y la ficha indica de dónde sale cada dato. En los modelos ya cargados el panel muestra lo que mide Ollama.
- **Motores.** El panel lanza `llama-server` o `python -m vllm.entrypoints.openai.api_server` con `CUDA_VISIBLE_DEVICES` limitado a las GPU elegidas, escuchando en `0.0.0.0` (la API queda accesible en tu red, como la de Ollama). Las instancias se cierran al detener o reiniciar el panel. Ollama no deja elegir GPU por modelo, solo para todo el servidor; si una instancia comparte GPU con modelos de Ollama, compiten por la memoria. vLLM reserva de entrada la fracción de VRAM indicada en cada GPU.
- **Cuantizar.** Las versiones recientes de Ollama (comprobado en la 0.40.16) solo cuantizan al importar safetensors. Por eso el panel lee el GGUF del almacén de Ollama, ejecuta `llama-quantize` y registra el resultado. El usuario del panel debe poder leer la carpeta de modelos; el instalador lo añade al grupo `ollama`.
- **Entrenar.** Ollama no entrena. `training/train_lora.py` carga el modelo base de Hugging Face (en 4 bits si eliges QLoRA, repartido entre las GPU), entrena un adaptador LoRA, lo convierte a GGUF con llama.cpp y crea en Ollama un modelo nuevo: el modelo de Ollama que elijas más el adaptador. El modelo de Hugging Face y el de Ollama deben ser el mismo (por ejemplo `Qwen/Qwen2.5-7B-Instruct` y `qwen2.5:7b`).

### Formato de los datasets

Un ejemplo por línea, en cualquiera de estas formas:

```json
{"messages": [{"role": "system", "content": "…"}, {"role": "user", "content": "…"}, {"role": "assistant", "content": "…"}]}
{"instruction": "…", "input": "opcional", "output": "…"}
{"prompt": "…", "response": "…"}
```

## Desarrollo

```bash
OLLAMA_URL=http://IP-DEL-SERVIDOR:11434 PANEL_PORT=8765 python server.py
```

Funciona en cualquier sistema apuntando a un Ollama remoto. Lo que depende de la máquina (GPU, registros, cuantización) solo se activa cuando el panel corre junto a Ollama. `PANEL_LOCAL_GPUS=1` muestra las GPU de la máquina local para probar la interfaz.
