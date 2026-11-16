# Panel IA Server

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
| **Chat de prueba** | Conversación rápida para comprobar un modelo, con razonamiento visible e imágenes si el modelo las admite. Con modelos de audio (como `lfm3-audio` o `lfm3-omni`) puedes **hablarle** con el micrófono o adjuntar un audio, y **escuchar** la respuesta. El micrófono necesita HTTPS (`--https`). |
| **Entrenamiento** | Fine-tuning LoRA/QLoRA con PyTorch sobre el modelo original de Hugging Face, validación de datasets `.jsonl` y registro del adaptador en Ollama. |
| **Registros** | `journalctl -u ollama`, con actualización automática. |
| **Acceso y API** | Una API compatible con OpenAI en `http://IP:8080/v1` para tus apps (Open WebUI, Continue, Cline, tu código), dentro o fuera de casa. Sirve los modelos de Ollama y las instancias de los motores, y solo responde con una **clave de API** que creas y revocas desde el panel. Solo admite chat, completions y embeddings. |
| **Actualizaciones** | El panel se actualiza desde este repositorio. Busca cambios cada 6 horas y, si el servidor está libre, se instala solo; también a mano, viendo antes la lista de cambios. |

## Instalación

En el servidor, con Python 3.8 o superior (sin dependencias para el panel en sí):

```bash
git clone https://github.com/hernanJardon/ia-server-web.git
cd ia-server-web
sudo ./install.sh                # solo el panel
sudo ./install.sh --llama-cpp    # + llama-quantize y llama-server: Cuantizar y el motor llama.cpp
sudo ./install.sh --train        # + PyTorch/PEFT para Entrenamiento (incluye --llama-cpp)
sudo ./install.sh --vllm         # + vLLM como motor (entorno propio)
sudo ./install.sh --https        # HTTPS con certificado propio (necesario para hablar por micrófono)
```

Las opciones se pueden combinar (`sudo ./install.sh --train --vllm`).

El instalador clona el repositorio en `/opt/ollama-panel` (así puede actualizarse solo), guarda los datos en `/var/lib/ollama-panel`, pide una contraseña opcional y crea el servicio `ollama-panel`. Después abre `http://IP-DEL-SERVIDOR:8080`.

- `--llama-cpp` necesita `git`, `cmake` y `build-essential`. Para que `llama-server` use las GPU hace falta además el CUDA Toolkit (`nvcc`, paquete `nvidia-cuda-toolkit`); sin él se compila solo para CPU y el panel lo avisa.
- `--vllm` instala vLLM en `/var/lib/ollama-panel/vllm-venv`. Con GPU de 12 GB, los modelos de más de 7B necesitan versiones cuantizadas en AWQ o GPTQ (por ejemplo `Qwen/Qwen2.5-14B-Instruct-AWQ` en 2 GPU). Para modelos con acceso restringido, añade `HF_TOKEN` a `/etc/ollama-panel.env`.
- `--train` descarga varios GB (PyTorch con CUDA) y necesita `python3-venv`.
- El código se actualiza solo (vista Actualizaciones). Si una versión nueva necesita dependencias nuevas, vuelve a ejecutar `sudo ./install.sh` con las opciones que uses.
- Para desinstalar: `sudo ./install.sh --remove` (los datos se conservan).

La configuración está en `/etc/ollama-panel.env`; tras cambiarla, `sudo systemctl restart ollama-panel`.

| Variable | Por defecto | |
|---|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | API de Ollama |
| `PANEL_HOST` / `PANEL_PORT` | `0.0.0.0` / `8080` | Dónde escucha el panel |
| `PANEL_PASSWORD` | vacía | Si se define, el navegador la pide (HTTP Basic, cualquier usuario). No se usa para la API `/v1`, que va con claves |
| `PANEL_TLS_CERT` / `PANEL_TLS_KEY` | vacías | Certificado y clave PEM: si están las dos, el panel y la API se sirven por HTTPS |
| `PANEL_DATA` | `/var/lib/ollama-panel` | Datasets, trabajos y entornos |
| `TRAIN_PYTHON` | `$PANEL_DATA/venv/bin/python` | Intérprete con torch y peft |
| `LLAMA_CPP_DIR` | `$PANEL_DATA/llama.cpp` | Para `llama-quantize` y la conversión de adaptadores |

## Seguridad y acceso desde fuera

El panel puede borrar modelos y lanzar procesos: ponle contraseña. Las peticiones que modifican algo se rechazan si vienen de otra web abierta en el navegador (comprobación de `Origin`).

- **API `/v1` con claves.** Cada app o equipo lleva su propia clave (`Authorization: Bearer sk-op-…`). El panel solo guarda su SHA-256, así que la clave se ve una única vez, al crearla. Revocar una no afecta a las demás.
- **Intentos fallidos.** Tras 20 intentos fallidos de clave o contraseña en 10 minutos, esa IP queda bloqueada 10 minutos. Si pones un proxy inverso delante, todas las peticiones llegan con la IP del proxy y comparten ese límite.
- **Desde fuera de casa, lo recomendado es una VPN** ([Tailscale](https://tailscale.com) o WireGuard): no abres puertos en el router.
- **Si abres un puerto**, activa HTTPS (`PANEL_TLS_CERT` y `PANEL_TLS_KEY`, por ejemplo con Let's Encrypt). Redirige solo el puerto del panel, nunca el 11434 de Ollama ni los de los motores: esos responden sin clave.
- Con `OLLAMA_HOST=0.0.0.0`, Ollama sigue abierto en tu red local sin clave; la vista Acceso lo avisa. Para cerrarlo, deja `OLLAMA_HOST=127.0.0.1` en el servicio de Ollama (`sudo systemctl edit ollama`). Las apps de casa que lo usaban directamente pasan entonces a usar el panel con una clave.

## Actualizaciones

La copia instalada es un clon de git. Cada 6 horas el panel hace `git fetch`, y si hay commits nuevos en `main` y no hay entrenamientos, cuantizaciones, motores ni descargas en marcha, hace `git pull --ff-only`. Comprueba que el código nuevo compila (si no, vuelve al commit anterior y no reintenta esa versión) y sale para que systemd lo relance. Ambas cosas se pueden desactivar en la vista Actualizaciones. Si el repositorio es privado, el usuario del servicio necesita credenciales de git para leerlo.

## Cómo funciona

- `server.py` sirve la interfaz y hace de proxy de `/api/*` de Ollama en `/ollama/*`, con streaming, de modo que el progreso de descargas y respuestas llega en directo. Cancelar en el navegador corta también la operación en Ollama.
- La ocupación por GPU sale de `nvidia-smi`. Para saber qué modelo ocupa cada tarjeta, el panel cruza los procesos de `nvidia-smi` con el GGUF que carga cada `ollama runner`.
- El veredicto de cabida suma pesos + caché KV (capas con atención × cabezas KV × dimensiones × contexto) × peticiones en paralelo + el estado recurrente de los modelos híbridos + búferes, y reparte entre tarjetas reservando 0,6 GiB en cada una. El contexto, el paralelismo y el tipo de caché salen de `OLLAMA_CONTEXT_LENGTH`, `OLLAMA_NUM_PARALLEL` y `OLLAMA_KV_CACHE_TYPE` del servicio de Ollama. Si no están definidas, se deducen de los modelos cargados, y la ficha indica de dónde sale cada dato. En los modelos ya cargados el panel muestra lo que mide Ollama.
- **Voz.** El navegador graba en su formato (webm/opus) y el panel lo convierte a WAV mono de 16 kHz antes de enviarlo. En Ollama 0.40.x el audio viaja en el campo `images` de `/api/chat`, porque el campo `audio` se ignora ([ollama#19378](https://github.com/ollama/ollama/issues/19378)). La respuesta hablada se pide a `/v1/audio/speech` con un modelo que declare la capacidad `speech`; si no devuelve audio, suena la voz del navegador y el chat lo indica. El certificado de `--https` es propio: el navegador avisará la primera vez.
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
