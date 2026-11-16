#!/usr/bin/env python3
"""Panel web para administrar un servidor Ollama.

Solo usa la biblioteca estándar (Python 3.8+). Configuración por variables de entorno:

  OLLAMA_URL      URL de la API de Ollama        (por defecto http://127.0.0.1:11434)
  PANEL_HOST      interfaz donde escucha          (por defecto 0.0.0.0)
  PANEL_PORT      puerto del panel                (por defecto 8080)
  PANEL_PASSWORD  si se define, exige HTTP Basic  (cualquier usuario, esta contraseña)
  PANEL_DATA      carpeta de datos del panel      (por defecto ./data)
  TRAIN_PYTHON    intérprete con torch/peft       (por defecto ./data/venv/bin/python o el actual)
  LLAMA_CPP_DIR   clon de llama.cpp, para convertir adaptadores LoRA a GGUF (opcional)
  PANEL_TLS_CERT  certificado PEM: si se define junto a PANEL_TLS_KEY, el panel sirve HTTPS
  PANEL_TLS_KEY   clave privada PEM del certificado
"""
import base64
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import re
import secrets
import shutil
import ssl
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from training.train_lora import validate_dataset  # noqa: E402  (solo stdlib al importar)

STATIC = os.path.join(ROOT, "static")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
HOST = os.environ.get("PANEL_HOST", "0.0.0.0")
PORT = int(os.environ.get("PANEL_PORT", "8080"))
PASSWORD = os.environ.get("PANEL_PASSWORD", "")
DATA = os.path.abspath(os.environ.get("PANEL_DATA", os.path.join(ROOT, "data")))
LLAMA_CPP_DIR = os.environ.get("LLAMA_CPP_DIR", "")
TLS_CERT = os.environ.get("PANEL_TLS_CERT", "")
TLS_KEY = os.environ.get("PANEL_TLS_KEY", "")
UPLOADS = os.path.join(DATA, "uploads")
DATASETS = os.path.join(DATA, "datasets")
JOBS = os.path.join(DATA, "jobs")
for _d in (UPLOADS, DATASETS, JOBS):
    os.makedirs(_d, exist_ok=True)

_u = urlsplit(OLLAMA_URL)
UP_HOST = _u.hostname or "127.0.0.1"
UP_PORT = _u.port or (443 if _u.scheme == "https" else 11434)
UP_TLS = _u.scheme == "https"
SAME_HOST = UP_HOST in ("127.0.0.1", "localhost", "::1")

MAX_JSON_BODY = 256 * 1024 * 1024
MODEL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]*(:[A-Za-z0-9._\-]+)?$")
FILE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]{0,120}$")
HF_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]*/[A-Za-z0-9._\-]+$")


def train_python():
    explicit = os.environ.get("TRAIN_PYTHON")
    if explicit:
        return explicit
    venv = os.path.join(DATA, "venv", "bin", "python")
    return venv if os.path.exists(venv) else sys.executable


def upstream(timeout=3600):
    cls = http.client.HTTPSConnection if UP_TLS else http.client.HTTPConnection
    return cls(UP_HOST, UP_PORT, timeout=timeout)


# ---------------------------------------------------------------- sistema

def system_info():
    info = {"platform": sys.platform, "same_host": SAME_HOST, "ollama_url": OLLAMA_URL,
            "cpu_count": os.cpu_count(), "gpus": [], "llama_cpp": bool(LLAMA_CPP_DIR), "ollama_env": ollama_service_env()}
    try:
        with open("/proc/loadavg") as f:
            info["load"] = [float(x) for x in f.read().split()[:3]]
        mem = {}
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                mem[key] = int(rest.split()[0]) * 1024
        info["mem_total"] = mem.get("MemTotal")
        info["mem_available"] = mem.get("MemAvailable")
    except OSError:
        pass
    candidates = [os.environ.get("OLLAMA_MODELS"), "/usr/share/ollama/.ollama/models",
                  os.path.expanduser("~/.ollama/models"), DATA]
    for path in candidates:
        if path and os.path.isdir(path):
            try:
                usage = shutil.disk_usage(path)
                info["disk"] = {"path": path, "total": usage.total, "free": usage.free}
                break
            except OSError:
                continue
    # Las GPU de otra máquina no dicen nada del servidor de Ollama: solo se leen en la misma.
    smi = shutil.which("nvidia-smi") if SAME_HOST or os.environ.get("PANEL_LOCAL_GPUS") else None
    if smi:
        num = lambda s: float(s) if re.match(r"^-?\d+(\.\d+)?$", s) else None
        try:
            out = subprocess.run(
                [smi, "--query-gpu=index,uuid,name,memory.used,memory.total,utilization.gpu,temperature.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=8).stdout
            for line in out.strip().splitlines():
                p = [x.strip() for x in line.split(",")]
                if len(p) >= 7:
                    info["gpus"].append({"index": p[0], "uuid": p[1], "name": p[2],
                                         "mem_used": (num(p[3]) or 0) * 1048576,
                                         "mem_total": (num(p[4]) or 0) * 1048576,
                                         "util": num(p[5]), "temp": num(p[6]), "procs": []})
            by_uuid = {g["uuid"]: g for g in info["gpus"]}
            out = subprocess.run(
                [smi, "--query-compute-apps=gpu_uuid,pid,used_memory", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=8).stdout
            for line in out.strip().splitlines():
                p = [x.strip() for x in line.split(",")]
                if len(p) >= 3 and p[0] in by_uuid:
                    by_uuid[p[0]]["procs"].append({"pid": p[1], "mem": (num(p[2]) or 0) * 1048576,
                                                   "blob": runner_blob(p[1])})
        except (OSError, subprocess.SubprocessError):
            pass
    return info


_ollama_env_cache = {"at": 0, "value": None}
OLLAMA_ENV_KEYS = ("OLLAMA_HOST", "OLLAMA_NUM_PARALLEL", "OLLAMA_CONTEXT_LENGTH", "OLLAMA_KV_CACHE_TYPE", "OLLAMA_FLASH_ATTENTION",
                   "OLLAMA_KEEP_ALIVE", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_SCHED_SPREAD", "CUDA_VISIBLE_DEVICES")


def ollama_service_env():
    """Variables OLLAMA_* del servicio systemd de Ollama (las que cambian cuánta VRAM reserva). None si no se pueden leer."""
    if not SAME_HOST or not shutil.which("systemctl"):
        return None
    if time.time() - _ollama_env_cache["at"] < 60:
        return _ollama_env_cache["value"]
    value = None
    try:
        out = subprocess.run(["systemctl", "show", "ollama", "-p", "Environment", "--value"],
                             capture_output=True, text=True, timeout=5).stdout
        value = {}
        for item in re.findall(r'(?:[^\s"]+|"[^"]*")+', out):
            key, _, val = item.strip('"').partition("=")
            if key in OLLAMA_ENV_KEYS:
                value[key] = val
    except (OSError, subprocess.SubprocessError):
        value = None
    _ollama_env_cache.update(at=time.time(), value=value)
    return value


def runner_blob(pid):
    """Digest del GGUF que carga un proceso 'ollama runner', leído de su línea de comandos."""
    try:
        with open("/proc/%s/cmdline" % int(pid), "rb") as f:
            args = f.read().decode("utf-8", "replace").split("\0")
    except (OSError, ValueError):
        return None
    for i, arg in enumerate(args):
        if arg in ("--model", "-m") and i + 1 < len(args):
            m = re.search(r"sha256[-:]([0-9a-f]{64})", args[i + 1])
            return "sha256:" + m.group(1) if m else None
    return None


def ollama_logs(lines):
    if not sys.platform.startswith("linux") or not shutil.which("journalctl"):
        return {"error": "Los logs solo están disponibles cuando el panel corre en el servidor Linux (journalctl)."}
    if not SAME_HOST:
        return {"error": "El panel no corre en la misma máquina que Ollama, no puede leer sus logs."}
    try:
        r = subprocess.run(["journalctl", "-u", "ollama", "-n", str(lines), "--no-pager", "-o", "short-iso"],
                           capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError) as e:
        return {"error": "No se pudo ejecutar journalctl: %s" % e}
    text = r.stdout.strip()
    if not text or "No entries" in text:
        return {"error": "journalctl no devolvió entradas. Agrega el usuario del panel al grupo systemd-journal. "
                         + r.stderr.strip()[:300]}
    return {"log": text}


def train_env():
    code = (
        "import json,sys\n"
        "o={'python':sys.version.split()[0]}\n"
        "for m in ('torch','transformers','peft','accelerate','bitsandbytes'):\n"
        "    try:\n"
        "        o[m]=__import__(m).__version__\n"
        "    except Exception as e:\n"
        "        o[m]=None\n"
        "try:\n"
        "    import torch\n"
        "    o['cuda']=torch.cuda.is_available()\n"
        "    if o['cuda']:\n"
        "        o['gpu']=torch.cuda.get_device_name(0)\n"
        "        o['vram']=torch.cuda.get_device_properties(0).total_memory\n"
        "except Exception:\n"
        "    o['cuda']=False\n"
        "print(json.dumps(o))\n")
    py = train_python()
    try:
        r = subprocess.run([py, "-c", code], capture_output=True, text=True, timeout=120)
        env = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:  # intérprete inexistente, salida inesperada, timeout
        return {"interpreter": py, "error": str(e)}
    env["interpreter"] = py
    env["llama_cpp"] = LLAMA_CPP_DIR if LLAMA_CPP_DIR and os.path.isdir(LLAMA_CPP_DIR) else None
    env["ready"] = bool(env.get("torch") and env.get("transformers") and env.get("peft") and env.get("cuda"))
    return env


# ---------------------------------------------------------------- trabajos de entrenamiento

class JobManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.procs = {}

    def _path(self, job_id, name="job.json"):
        return os.path.join(JOBS, job_id, name)

    def _load(self, job_id):
        with open(self._path(job_id), encoding="utf-8") as f:
            return json.load(f)

    def _save(self, job):
        tmp = self._path(job["id"], "job.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self._path(job["id"]))

    def list(self, kind=None):
        jobs = []
        for job_id in os.listdir(JOBS):
            try:
                job = self._load(job_id)
            except (OSError, ValueError):
                continue
            if kind and job.get("kind", "train") != kind:
                continue
            # Un trabajo "running" sin proceso vivo quedó huérfano por un reinicio del panel.
            if job["status"] == "running" and job_id not in self.procs:
                job["status"] = "interrupted"
                self._save(job)
            jobs.append(job)
        jobs.sort(key=lambda j: j["created"], reverse=True)
        return jobs

    SCRIPTS = {"train": "train_lora.py", "quantize": "quantize_gguf.py"}
    BUSY = {"train": "Ya hay un entrenamiento en curso. Espera a que termine o cancélalo.",
            "quantize": "Ya hay una cuantización en curso. Espera a que termine o cancélala."}

    def start(self, config, kind="train"):
        with self.lock:
            if any(p.kind == kind for p in self.procs.values()):
                raise ValueError(self.BUSY[kind])
            job_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
            os.makedirs(os.path.join(JOBS, job_id))
            config = dict(config, job_dir=os.path.join(JOBS, job_id), ollama_url=OLLAMA_URL,
                          llama_cpp_dir=LLAMA_CPP_DIR)
            job = {"id": job_id, "kind": kind, "created": time.time(), "status": "running", "config": config}
            self._save(job)
            log = open(self._path(job_id, "log.txt"), "wb")
            env = dict(os.environ, PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
            python = train_python() if kind == "train" else sys.executable
            try:
                proc = subprocess.Popen(
                    [python, "-u", os.path.join(ROOT, "training", self.SCRIPTS[kind]), "--config", self._path(job_id)],
                    stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env, cwd=ROOT)
            except OSError as e:
                log.close()
                job["status"] = "failed"
                job["error"] = "No se pudo lanzar %s: %s" % (python, e)
                self._save(job)
                raise ValueError(job["error"])
            proc.kind = kind
            self.procs[job_id] = proc
        threading.Thread(target=self._wait, args=(job_id, proc, log), daemon=True).start()
        return job

    def _wait(self, job_id, proc, log):
        code = proc.wait()
        log.close()
        with self.lock:
            self.procs.pop(job_id, None)
            job = self._load(job_id)
            if job["status"] == "running":
                job["status"] = "done" if code == 0 else "failed"
            job["exit_code"] = code
            job["finished"] = time.time()
            self._save(job)

    def cancel(self, job_id):
        with self.lock:
            proc = self.procs.get(job_id)
            if not proc:
                return False
            job = self._load(job_id)
            job["status"] = "cancelled"
            self._save(job)
            proc.terminate()
        return True

    def delete(self, job_id):
        with self.lock:
            if job_id in self.procs:
                raise ValueError("El trabajo sigue en curso. Cancélalo antes de borrarlo.")
            shutil.rmtree(os.path.join(JOBS, job_id), ignore_errors=True)

    def log(self, job_id, offset):
        path = self._path(job_id, "log.txt")
        with open(path, "rb") as f:
            f.seek(offset)
            data = f.read(512 * 1024)
        return {"text": data.decode("utf-8", "replace"), "offset": offset + len(data)}


jobs = JobManager()

QUANT_TYPES = ["Q2_K", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q4_0", "Q4_K_S", "Q4_K_M", "IQ4_XS",
               "Q5_0", "Q5_K_S", "Q5_K_M", "Q6_K", "Q8_0", "F16", "BF16"]


def llama_quantize():
    explicit = os.environ.get("LLAMA_QUANTIZE")
    if explicit and os.path.isfile(explicit):
        return explicit
    if LLAMA_CPP_DIR:
        for rel in ("build/bin/llama-quantize", "llama-quantize"):
            path = os.path.join(LLAMA_CPP_DIR, rel)
            if os.path.isfile(path):
                return path
    return shutil.which("llama-quantize")


def quantize_env():
    binary = llama_quantize()
    if not SAME_HOST:
        return {"available": False, "binary": binary,
                "reason": "El panel no corre en la máquina de Ollama y no puede leer los archivos de los modelos."}
    if not binary:
        return {"available": False, "binary": None,
                "reason": "Falta llama-quantize. En el servidor: sudo ./install.sh --llama-cpp"}
    return {"available": True, "binary": binary, "types": QUANT_TYPES}


# ---------------------------------------------------------------- motor llama.cpp (llama-server)

def llama_server():
    explicit = os.environ.get("LLAMA_SERVER")
    if explicit and os.path.isfile(explicit):
        return explicit
    if LLAMA_CPP_DIR:
        for rel in ("build/bin/llama-server", "llama-server"):
            path = os.path.join(LLAMA_CPP_DIR, rel)
            if os.path.isfile(path):
                return path
    return shutil.which("llama-server")


_engine_env_cache = {}


def vllm_python():
    explicit = os.environ.get("VLLM_PYTHON")
    if explicit:
        return explicit
    venv = os.path.join(DATA, "vllm-venv", "bin", "python")
    return venv if os.path.exists(venv) else None


def engine_env():
    binary = llama_server()
    info = {"available": False, "binary": binary, "devices": []}
    if not SAME_HOST:
        info["reason"] = "El panel no corre en la máquina de Ollama y no puede leer los archivos de los modelos."
    elif not binary:
        info["reason"] = "Falta llama-server. En el servidor: sudo ./install.sh --llama-cpp"
    else:
        if binary not in _engine_env_cache:
            try:
                r = subprocess.run([binary, "--list-devices"], capture_output=True, text=True, timeout=30)
                text = r.stdout + r.stderr
            except (OSError, subprocess.SubprocessError) as e:
                text = "error: %s" % e
            _engine_env_cache[binary] = [l.strip() for l in text.splitlines() if re.match(r"^\s*(CUDA|Vulkan|ROCm|Metal)\d*:", l)]
        info["devices"] = _engine_env_cache[binary]
        info["available"] = True
        if not info["devices"]:
            info["warning"] = ("Este llama-server no ve ninguna GPU: se compiló sin CUDA y correrá en CPU. "
                               "Instala el CUDA Toolkit (nvcc) y repite sudo ./install.sh --llama-cpp.")

    py = vllm_python()
    vinfo = {"available": False, "python": py}
    if not py:
        vinfo["reason"] = "vLLM no está instalado. En el servidor: sudo ./install.sh --vllm"
    else:
        key = "vllm:" + py
        if key not in _engine_env_cache:
            try:
                r = subprocess.run([py, "-c", "import vllm; print(vllm.__version__)"], capture_output=True, text=True, timeout=120)
                _engine_env_cache[key] = r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip() else None
            except (OSError, subprocess.SubprocessError):
                _engine_env_cache[key] = None
        vinfo["version"] = _engine_env_cache[key]
        vinfo["available"] = bool(vinfo["version"])
        if not vinfo["available"]:
            vinfo["reason"] = "El entorno %s no puede importar vllm. Repite sudo ./install.sh --vllm." % py
    return {"llama_cpp": info, "vllm": vinfo}


def free_port(start=8090, end=8190):
    import socket
    used = {e["port"] for e in engines.instances.values() if e["status"] in ("loading", "ready")}
    for port in range(start, end):
        if port in used or port == PORT:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    raise ValueError("No hay puertos libres entre %d y %d." % (start, end))


def ollama_model_blob(model):
    """Ruta del GGUF de un modelo de Ollama y, si tiene, la de su proyector de visión."""
    conn = upstream(timeout=30)
    try:
        conn.request("POST", "/api/show", body=json.dumps({"model": model}), headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        data = json.loads(resp.read().decode("utf-8", "replace") or "{}")
    finally:
        conn.close()
    if resp.status != 200:
        raise ValueError(data.get("error") or "Ollama no encuentra el modelo %s." % model)
    froms = re.findall(r"^FROM\s+(\S*sha256[-:][0-9a-f]{64})\s*$", data.get("modelfile", ""), re.M)
    if not froms:
        raise ValueError("No encuentro el archivo GGUF de %s." % model)
    for path in froms:
        if not os.path.isfile(path):
            raise ValueError("El panel no puede leer %s. ¿Está el usuario del panel en el grupo ollama?" % path)
    if re.search(r"^ADAPTER\s", data.get("modelfile", ""), re.M):
        raise ValueError("El modelo tiene un adaptador LoRA; llama.cpp lo serviría sin él. Sírvelo desde Ollama.")
    return froms[0], (froms[1] if len(froms) > 1 else None), data


class EngineManager:
    """Instancias de llama-server lanzadas por el panel. Mueren con el panel (systemd las cierra al reiniciar)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.instances = {}
        self.dir = os.path.join(DATA, "engines")
        os.makedirs(self.dir, exist_ok=True)

    def public(self, inst):
        return {k: v for k, v in inst.items() if k != "proc"}

    def list(self):
        with self.lock:
            for inst in self.instances.values():
                self._refresh(inst)
            return [self.public(i) for i in sorted(self.instances.values(), key=lambda i: i["started"], reverse=True)]

    def _refresh(self, inst):
        proc = inst.get("proc")
        if proc is None or inst["status"] in ("stopped", "failed"):
            return
        code = proc.poll()
        if code is not None:
            inst["status"] = "stopped" if inst.get("stopping") else "failed"
            inst["exit_code"] = code
            inst["proc"] = None
            return
        if inst["status"] == "loading":
            try:
                c = http.client.HTTPConnection("127.0.0.1", inst["port"], timeout=1.5)
                c.request("GET", "/health")
                r = c.getresponse()
                r.read()
                c.close()
                if r.status == 200:
                    inst["status"] = "ready"
            except OSError:
                pass

    def start(self, body):
        engine = body.get("engine", "llama.cpp")
        if engine not in ("llama.cpp", "vllm"):
            raise ValueError("Motor desconocido.")
        env = engine_env()["llama_cpp" if engine == "llama.cpp" else "vllm"]
        if not env["available"]:
            raise ValueError(env["reason"])
        model = str(body.get("model", "")).strip()
        if engine == "llama.cpp" and not MODEL_NAME_RE.match(model):
            raise ValueError("Nombre de modelo inválido.")
        if engine == "vllm" and not (HF_ID_RE.match(model) or os.path.isdir(model)):
            raise ValueError("Para vLLM indica un id de Hugging Face (org/modelo) o una carpeta local con el modelo.")
        gpus = body.get("gpus") or []
        if not isinstance(gpus, list) or not all(re.match(r"^\d{1,2}$", str(g)) for g in gpus):
            raise ValueError("Selección de GPU inválida.")
        if engine == "vllm" and len(gpus) not in (1, 2, 4, 8):
            raise ValueError("vLLM reparte el modelo con paralelismo de tensor: elige 1, 2 o 4 GPU.")

        def num(key, default, lo, hi):
            try:
                v = int(body.get(key, default))
            except (TypeError, ValueError):
                raise ValueError("Valor inválido en %s" % key)
            if not lo <= v <= hi:
                raise ValueError("%s debe estar entre %d y %d" % (key, lo, hi))
            return v

        ctx = num("ctx", 8192, 256, 1048576)
        parallel = num("parallel", 1, 1, 64)
        ngl = num("ngl", 999, 0, 999)
        split = body.get("split", "layer")
        if split not in ("layer", "row"):
            raise ValueError("Modo de reparto inválido.")
        extra = str(body.get("extra", "")).split()
        if any(a in ("-m", "--model", "--host", "--port") or a.startswith(("--model=", "--host=", "--port=")) for a in extra):
            raise ValueError("Los argumentos extra no pueden cambiar el modelo, el host ni el puerto.")
        mem_util = body.get("gpu_memory_utilization", 0.9)
        try:
            mem_util = float(mem_util)
        except (TypeError, ValueError):
            raise ValueError("Fracción de memoria inválida.")
        if not 0.1 <= mem_util <= 0.98:
            raise ValueError("La fracción de memoria de vLLM debe estar entre 0.1 y 0.98.")
        mmproj = None
        if engine == "llama.cpp":
            blob, mmproj, _ = ollama_model_blob(model)
        alias = str(body.get("alias", "")).strip() or (model.split("/")[-1].lower() if engine == "vllm" else model)
        if not MODEL_NAME_RE.match(alias):
            raise ValueError("Alias inválido.")

        with self.lock:
            port = free_port()
            inst_id = uuid.uuid4().hex[:8]
            log_path = os.path.join(self.dir, inst_id + ".log")
            if engine == "llama.cpp":
                cmd = [env["binary"], "-m", blob, "--host", "0.0.0.0", "--port", str(port), "--alias", alias,
                       "-c", str(ctx * parallel), "-np", str(parallel), "-ngl", str(ngl), "--split-mode", split, "--jinja"]
                if mmproj:
                    cmd += ["--mmproj", mmproj]
                if body.get("flash_attn"):
                    cmd += ["-fa", "on"]
            else:
                cmd = [env["python"], "-m", "vllm.entrypoints.openai.api_server", "--model", model,
                       "--served-model-name", alias, "--host", "0.0.0.0", "--port", str(port),
                       "--tensor-parallel-size", str(len(gpus)), "--max-model-len", str(ctx),
                       "--max-num-seqs", str(parallel), "--gpu-memory-utilization", str(mem_util)]
            cmd += extra
            proc_env = dict(os.environ)
            if engine == "vllm":
                proc_env.setdefault("VLLM_WORKER_MULTIPROC_METHOD", "spawn")
            if gpus:
                proc_env["CUDA_VISIBLE_DEVICES"] = ",".join(str(g) for g in gpus)
            log = open(log_path, "wb")
            try:
                proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=proc_env)
            except OSError as e:
                raise ValueError("No se pudo lanzar %s: %s" % (engine, e))
            finally:
                log.close()
            inst = {"id": inst_id, "engine": engine, "model": model, "alias": alias, "gpus": [int(g) for g in gpus],
                    "port": port, "ctx": ctx, "parallel": parallel, "ngl": ngl, "split": split,
                    "flash_attn": bool(body.get("flash_attn")), "gpu_memory_utilization": mem_util,
                    "vision": bool(mmproj), "pid": proc.pid, "started": time.time(), "status": "loading",
                    "cmd": " ".join(cmd), "proc": proc}
            self.instances[inst_id] = inst
            return self.public(inst)

    def stop(self, inst_id):
        with self.lock:
            inst = self.instances.get(inst_id)
            if not inst:
                raise FileNotFoundError(inst_id)
            proc = inst.get("proc")
            if proc and proc.poll() is None:
                inst["stopping"] = True
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
            self._refresh(inst)
            if inst["status"] in ("loading", "ready"):
                inst["status"] = "stopped"

    def remove(self, inst_id):
        with self.lock:
            inst = self.instances.get(inst_id)
            if not inst:
                raise FileNotFoundError(inst_id)
            if inst.get("proc") and inst["proc"].poll() is None:
                raise ValueError("La instancia sigue en marcha. Detenla antes.")
            del self.instances[inst_id]
        try:
            os.remove(os.path.join(self.dir, inst_id + ".log"))
        except OSError:
            pass

    def log(self, inst_id, offset):
        if not re.match(r"^[0-9a-f]{8}$", inst_id):
            raise FileNotFoundError(inst_id)
        with open(os.path.join(self.dir, inst_id + ".log"), "rb") as f:
            f.seek(offset)
            data = f.read(512 * 1024)
        return {"text": data.decode("utf-8", "replace"), "offset": offset + len(data)}

    def by_alias(self, alias):
        with self.lock:
            for inst in self.instances.values():
                self._refresh(inst)
                if inst["alias"] == alias and inst["status"] == "ready":
                    return dict(self.public(inst))
        return None

    def port_of(self, inst_id):
        inst = self.instances.get(inst_id)
        if not inst or inst["status"] not in ("loading", "ready"):
            raise FileNotFoundError(inst_id)
        return inst["port"]

    def stop_all(self):
        for inst_id in list(self.instances):
            try:
                self.stop(inst_id)
            except Exception:
                pass


engines = EngineManager()


def parse_quantize_request(body):
    source = str(body.get("from", "")).strip()
    output = str(body.get("output", "")).strip()
    qtype = str(body.get("type", ""))
    if not MODEL_NAME_RE.match(source) or not MODEL_NAME_RE.match(output):
        raise ValueError("Nombre de modelo inválido.")
    if qtype not in QUANT_TYPES:
        raise ValueError("Tipo de cuantización no soportado.")
    env = quantize_env()
    if not env["available"]:
        raise ValueError(env["reason"])
    return {"from": source, "output": output, "type": qtype, "llama_quantize": env["binary"],
            "allow_requantize": bool(body.get("allow_requantize")), "threads": os.cpu_count()}


def parse_train_request(body):
    def number(key, default, lo, hi, cast=float):
        try:
            value = cast(body.get(key, default))
        except (TypeError, ValueError):
            raise ValueError("Valor inválido en %s" % key)
        if not lo <= value <= hi:
            raise ValueError("%s debe estar entre %s y %s" % (key, lo, hi))
        return value

    base = str(body.get("base_model", "")).strip()
    if not (HF_ID_RE.match(base) or os.path.isdir(base)):
        raise ValueError("El modelo base debe ser un id de Hugging Face (org/modelo) o una carpeta local existente.")
    dataset = str(body.get("dataset", ""))
    if not FILE_NAME_RE.match(dataset) or not os.path.isfile(os.path.join(DATASETS, dataset)):
        raise ValueError("Dataset no encontrado.")
    output = str(body.get("output_model", "")).strip()
    ollama_from = str(body.get("ollama_from", "")).strip()
    dry = bool(body.get("dry_run"))
    if not dry:
        if not MODEL_NAME_RE.match(output):
            raise ValueError("Nombre de modelo de salida inválido.")
        if not MODEL_NAME_RE.match(ollama_from):
            raise ValueError("Indica el modelo de Ollama sobre el que se aplicará el adaptador.")
    return {
        "base_model": base, "dataset": os.path.join(DATASETS, dataset), "dataset_name": dataset,
        "output_model": output, "ollama_from": ollama_from, "dry_run": dry,
        "epochs": number("epochs", 3, 0.1, 100),
        "learning_rate": number("learning_rate", 2e-4, 1e-7, 1e-2),
        "lora_r": number("lora_r", 16, 1, 512, int),
        "lora_alpha": number("lora_alpha", 32, 1, 1024, int),
        "max_seq_len": number("max_seq_len", 1024, 64, 32768, int),
        "batch_size": number("batch_size", 1, 1, 256, int),
        "grad_accum": number("grad_accum", 8, 1, 512, int),
        "load_4bit": bool(body.get("load_4bit", True)),
    }


# ---------------------------------------------------------------- ajustes, claves de API y límite de intentos

SETTINGS_PATH = os.path.join(DATA, "settings.json")
SETTINGS_DEFAULTS = {"auto_check": True, "auto_install": True}
_settings_lock = threading.Lock()


def load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    return {k: bool(data.get(k, v)) for k, v in SETTINGS_DEFAULTS.items()}


def save_settings(patch):
    with _settings_lock:
        cur = load_settings()
        for k in SETTINGS_DEFAULTS:
            if k in patch:
                cur[k] = bool(patch[k])
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cur, f)
        os.replace(tmp, SETTINGS_PATH)
        return cur


class KeyStore:
    """Claves de la API /v1. Se guarda solo el SHA-256; la clave se muestra una vez al crearla."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.dirty_at = 0.0
        try:
            with open(path, encoding="utf-8") as f:
                self.keys = json.load(f)
        except (OSError, ValueError):
            self.keys = []

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.keys, f, indent=1)
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)

    def public(self):
        with self.lock:
            return [{k: v for k, v in rec.items() if k != "hash"} for rec in self.keys]

    def create(self, name):
        name = str(name or "").strip()[:60]
        if not name:
            raise ValueError("Pon un nombre a la clave (por ejemplo, el de la app que la usará).")
        secret = "sk-op-" + secrets.token_urlsafe(32)
        rec = {"id": uuid.uuid4().hex[:8], "name": name, "hash": hashlib.sha256(secret.encode()).hexdigest(),
               "hint": secret[-4:], "created": time.time(), "last_used": None, "requests": 0}
        with self.lock:
            self.keys.append(rec)
            self._save()
        return secret, {k: v for k, v in rec.items() if k != "hash"}

    def revoke(self, key_id):
        with self.lock:
            before = len(self.keys)
            self.keys = [k for k in self.keys if k["id"] != key_id]
            if len(self.keys) == before:
                raise FileNotFoundError(key_id)
            self._save()

    def verify(self, secret):
        digest = hashlib.sha256(secret.encode()).hexdigest()
        with self.lock:
            for rec in self.keys:
                if hmac.compare_digest(rec["hash"], digest):
                    rec["last_used"] = time.time()
                    rec["requests"] += 1
                    if time.time() - self.dirty_at > 30:  # no escribir el archivo en cada petición
                        self.dirty_at = time.time()
                        self._save()
                    return rec
        return None


class AuthLimiter:
    """Bloquea una IP 10 minutos tras 20 intentos fallidos de contraseña o de clave."""
    WINDOW, LIMIT = 600, 20

    def __init__(self):
        self.lock = threading.Lock()
        self.fails = {}

    def blocked(self, ip):
        with self.lock:
            recent = [t for t in self.fails.get(ip, []) if time.time() - t < self.WINDOW]
            self.fails[ip] = recent
            return len(recent) >= self.LIMIT

    def fail(self, ip):
        with self.lock:
            self.fails.setdefault(ip, []).append(time.time())


keys = KeyStore(os.path.join(DATA, "api_keys.json"))
limiter = AuthLimiter()
active_streams = [0]  # descargas, chats y creaciones en curso a través del proxy
_streams_lock = threading.Lock()


# ---------------------------------------------------------------- actualización desde GitHub

class Updater:
    """La app instalada es un clon de git: comprobar = fetch, actualizar = pull --ff-only y reiniciar el servicio."""
    INTERVAL = 6 * 3600

    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"checked": None, "behind": 0, "log": [], "error": None, "updating": False,
                      "last_update": None, "remote": None}

    def git(self, *args, timeout=120):
        r = subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout).strip()[:400] or "git falló")
        return r.stdout.strip()

    def available(self):
        if not shutil.which("git"):
            return "Falta git en el servidor."
        if not os.path.isdir(os.path.join(ROOT, ".git")):
            return "Esta copia del panel no es un clon de git. Reinstala con la versión actual de install.sh."
        return None

    def info(self):
        out = dict(self.state, settings=load_settings(), managed=bool(os.environ.get("INVOCATION_ID")))
        reason = self.available()
        out["unavailable"] = reason
        if not reason:
            try:
                out["current"] = self.git("log", "-1", "--format=%h%x09%s%x09%cI")
                out["branch"] = self.git("rev-parse", "--abbrev-ref", "HEAD")
                out["remote"] = self.git("remote", "get-url", "origin")
            except (RuntimeError, OSError, subprocess.SubprocessError) as e:
                out["unavailable"] = str(e)
        return out

    def check(self):
        reason = self.available()
        if reason:
            raise ValueError(reason)
        try:
            branch = self.git("rev-parse", "--abbrev-ref", "HEAD")
            self.git("fetch", "--quiet", "origin", branch, timeout=60)
            behind = int(self.git("rev-list", "--count", "HEAD..origin/" + branch) or 0)
            self.state["remote_head"] = self.git("rev-parse", "origin/" + branch)
            log = self.git("log", "--format=%h%x09%s%x09%cI", "HEAD..origin/" + branch, "-n", "30")
            dirty = bool(self.git("status", "--porcelain", "--untracked-files=no"))
        except (RuntimeError, OSError, subprocess.SubprocessError) as e:
            self.state.update(checked=time.time(), error="No se pudo consultar GitHub: %s" % e)
            raise ValueError(self.state["error"])
        self.state.update(checked=time.time(), error=None, behind=behind, dirty=dirty,
                          log=[dict(zip(("hash", "subject", "date"), l.split("\t", 2))) for l in log.splitlines() if l])
        return self.info()

    def busy(self):
        reasons = []
        if jobs.procs:
            reasons.append("hay un entrenamiento o una cuantización en curso")
        if any(e["status"] in ("loading", "ready") for e in engines.list()):
            reasons.append("hay instancias de motores en marcha (se cerrarían)")
        if active_streams[0] > 0:
            reasons.append("hay descargas o respuestas en curso")
        return reasons

    def apply(self, force=False):
        with self.lock:
            if self.state["updating"]:
                raise ValueError("Ya se está actualizando.")
            reasons = self.busy()
            if reasons and not force:
                raise ValueError("Ahora no: " + "; ".join(reasons) + ".")
            self.state["updating"] = True
        try:
            old = self.git("rev-parse", "HEAD")
            branch = self.git("rev-parse", "--abbrev-ref", "HEAD")
            self.git("pull", "--ff-only", "--quiet", "origin", branch, timeout=120)
            new = self.git("rev-parse", "HEAD")
            if new == old:
                self.state.update(updating=False, behind=0, log=[])
                return {"updated": False, "message": "Ya estaba al día."}
            check = subprocess.run([sys.executable, "-m", "py_compile", os.path.join(ROOT, "server.py"),
                                    os.path.join(ROOT, "training", "train_lora.py"), os.path.join(ROOT, "training", "quantize_gguf.py")],
                                   capture_output=True, text=True, timeout=60)
            if check.returncode != 0:
                self.git("reset", "--hard", old)
                self.state["updating"] = False
                self.state["bad_head"] = new  # la automática no lo reintenta hasta que llegue otro commit
                raise ValueError("La versión nueva no compila y se ha vuelto a la anterior: " + check.stderr.strip()[:300])
        except (RuntimeError, OSError, subprocess.SubprocessError) as e:
            self.state["updating"] = False
            raise ValueError("No se pudo actualizar: %s" % e)
        self.state.update(last_update=time.time(), behind=0, log=[])
        if os.environ.get("INVOCATION_ID"):
            # systemd (Restart=on-failure) vuelve a arrancar el panel con el código nuevo.
            threading.Timer(1.5, lambda: os._exit(3)).start()
            return {"updated": True, "restarting": True, "message": "Actualizado a %s. El panel se reinicia." % new[:7]}
        self.state["updating"] = False
        return {"updated": True, "restarting": False, "message": "Actualizado a %s. Reinicia el panel para usarlo." % new[:7]}

    def loop(self):
        time.sleep(120)
        while True:
            s = load_settings()
            if s["auto_check"] and not self.available():
                try:
                    self.check()
                    if (s["auto_install"] and self.state["behind"] and not self.state.get("dirty") and not self.busy()
                            and self.state.get("remote_head") != self.state.get("bad_head")):
                        self.apply()
                except ValueError:
                    pass
            time.sleep(self.INTERVAL)


updater = Updater()


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OllamaPanel/1"

    def log_message(self, fmt, *args):
        if os.environ.get("PANEL_VERBOSE"):
            super().log_message(fmt, *args)

    # -- utilidades de respuesta

    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if code >= 400:
            # Puede quedar cuerpo de la petición sin leer: no reutilizar la conexión.
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def fail(self, code, message):
        self.send_json(code, {"error": message})

    def start_stream(self, code=200, ctype="application/x-ndjson"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def chunk(self, data):
        if data:
            self.wfile.write(b"%x\r\n" % len(data) + data + b"\r\n")
            self.wfile.flush()

    def line(self, obj):
        self.chunk(json.dumps(obj, ensure_ascii=False).encode("utf-8") + b"\n")

    def end_stream(self):
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_JSON_BODY:
            raise ValueError("Cuerpo demasiado grande.")
        self.body_read = True
        raw = self.rfile.read(length) if length else b"{}"
        body = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(body, dict):
            raise ValueError("Se esperaba un objeto JSON.")
        return body

    # -- seguridad

    def authorized(self):
        if not PASSWORD:
            return True
        ip = self.client_address[0]
        if limiter.blocked(ip):
            self.fail(429, "Demasiados intentos fallidos desde esta dirección. Espera unos minutos.")
            return False
        header = self.headers.get("Authorization", "")
        if header.startswith("Basic "):
            try:
                given = base64.b64decode(header[6:]).decode("utf-8", "replace").partition(":")[2]
            except ValueError:
                given = ""
            if hmac.compare_digest(given.encode(), PASSWORD.encode()):
                return True
            limiter.fail(ip)
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Panel IA Server", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        return False

    def same_origin(self):
        # Evita que otra web abierta en el navegador dispare acciones contra el panel.
        origin = self.headers.get("Origin")
        return not origin or urlsplit(origin).netloc == self.headers.get("Host")

    # -- enrutado

    def handle_request(self):
        self.body_read = False
        try:
            self.dispatch()
        finally:
            # Un cuerpo que la ruta no leyó se quedaría en la conexión keep-alive y corrompería la petición siguiente.
            length = int(self.headers.get("Content-Length") or 0)
            if length and not self.body_read and not self.close_connection:
                if length <= 1 << 20:
                    try:
                        self.rfile.read(length)
                    except OSError:
                        self.close_connection = True
                else:
                    self.close_connection = True

    def end_headers(self):
        # La API /v1 se autentica con clave (sin cookies), así que puede atender a apps web de cualquier origen.
        if self.path.startswith("/v1/"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204 if self.path.startswith("/v1/") else 405)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def dispatch(self):
        try:
            if self.path.startswith("/v1/"):
                return self.gateway()
            if not self.authorized():
                return
            if self.command not in ("GET", "HEAD") and not self.same_origin():
                return self.fail(403, "Origen no permitido.")
            url = urlsplit(self.path)
            path = unquote(url.path)
            query = parse_qs(url.query)
            if path.startswith("/ollama/"):
                return self.proxy(path[len("/ollama/"):], url.query)
            em = re.match(r"^/engine/([0-9a-f]{8})/(.*)$", path)
            if em:
                port = engines.port_of(em.group(1))
                return self.proxy(em.group(2), url.query, conn=http.client.HTTPConnection("127.0.0.1", port, timeout=3600),
                                  prefix="/", label="llama-server en el puerto %d" % port)
            if path.startswith("/panel/"):
                return self.panel(path[len("/panel/"):], query)
            if self.command in ("GET", "HEAD"):
                return self.static(path)
            self.fail(405, "Método no permitido.")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except ValueError as e:
            self.safe_fail(400, str(e))
        except FileNotFoundError:
            self.safe_fail(404, "No encontrado.")
        except Exception as e:  # último recurso: que un fallo no tumbe el hilo sin respuesta
            self.safe_fail(500, "%s: %s" % (type(e).__name__, e))

    def safe_fail(self, code, message):
        try:
            self.fail(code, message)
        except OSError:
            self.close_connection = True

    do_GET = do_POST = do_DELETE = do_HEAD = do_PUT = handle_request

    # -- API compatible con OpenAI para apps externas, protegida con claves

    def oai_error(self, code, message, kind, bearer=False):
        data = json.dumps({"error": {"message": message, "type": kind, "code": kind}}, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if bearer:
            self.send_header("WWW-Authenticate", 'Bearer realm="Panel IA Server"')
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def gateway(self):
        ip = self.client_address[0]
        if limiter.blocked(ip):
            return self.oai_error(429, "Demasiados intentos fallidos desde esta dirección. Espera unos minutos.", "rate_limited")
        auth = self.headers.get("Authorization", "")
        secret = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
        if not secret or not keys.verify(secret):
            limiter.fail(ip)
            return self.oai_error(401, "Falta una clave de API válida (cabecera Authorization: Bearer sk-op-...).", "invalid_api_key", bearer=True)
        url = urlsplit(self.path)
        rest = unquote(url.path)[len("/v1/"):]
        if rest == "models" and self.command == "GET":
            return self.send_json(200, {"object": "list", "data": self.gateway_models()})
        if rest not in ("chat/completions", "completions", "embeddings") or self.command != "POST":
            return self.oai_error(404, "Esta API solo admite /v1/models, /v1/chat/completions, /v1/completions y /v1/embeddings.", "not_found")
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_JSON_BODY:
            return self.oai_error(413, "Petición demasiado grande.", "request_too_large")
        self.body_read = True
        raw = self.rfile.read(length) if length else b""
        try:
            model = str(json.loads(raw.decode("utf-8") or "{}").get("model", ""))
        except (ValueError, AttributeError):
            return self.oai_error(400, "El cuerpo debe ser JSON con el campo model.", "invalid_request_error")
        if not model:
            return self.oai_error(400, "Falta el campo model.", "invalid_request_error")
        inst = engines.by_alias(model)
        if inst:  # un motor del panel tiene prioridad sobre un modelo de Ollama con el mismo nombre
            conn = http.client.HTTPConnection("127.0.0.1", inst["port"], timeout=3600)
            return self.proxy(rest, url.query, conn=conn, prefix="/v1/", label="%s en el puerto %d" % (inst["engine"], inst["port"]), body=raw)
        return self.proxy(rest, url.query, prefix="/v1/", body=raw)

    def gateway_models(self):
        out = []
        conn = upstream(timeout=15)
        try:
            conn.request("GET", "/v1/models")
            resp = conn.getresponse()
            if resp.status == 200:
                out = json.loads(resp.read().decode("utf-8")).get("data", [])
        except (OSError, ValueError):
            pass
        finally:
            conn.close()
        for inst in engines.list():
            if inst["status"] == "ready":
                out.insert(0, {"id": inst["alias"], "object": "model", "created": int(inst["started"]), "owned_by": inst["engine"]})
        return out

    def static(self, path):
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        full = os.path.realpath(os.path.join(STATIC, rel))
        if not full.startswith(os.path.realpath(STATIC) + os.sep) or not os.path.isfile(full):
            return self.fail(404, "No encontrado.")
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # -- proxy transparente hacia la API de Ollama (con streaming)

    def proxy(self, rest, query, conn=None, prefix="/api/", label=None, body=None):
        if body is None:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_JSON_BODY:
                return self.fail(413, "Cuerpo demasiado grande.")
            self.body_read = True
            body = self.rfile.read(length) if length else None
        with _streams_lock:
            active_streams[0] += 1
        try:
            return self._proxy(rest, query, conn, prefix, label, body)
        finally:
            with _streams_lock:
                active_streams[0] -= 1

    def _proxy(self, rest, query, conn, prefix, label, body):
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")} if body else {}
        conn = conn or upstream()
        try:
            try:
                conn.request(self.command, prefix + rest + ("?" + query if query else ""), body=body, headers=headers)
                resp = conn.getresponse()
            except OSError as e:
                return self.fail(502, "No se pudo conectar con %s (%s)." % (label or "Ollama en " + OLLAMA_URL, e))
            no_body = self.command == "HEAD" or resp.status in (204, 304)
            if no_body:
                self.send_response(resp.status)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.start_stream(resp.status, resp.getheader("Content-Type", "application/json"))
            while True:
                data = resp.read1(65536)
                if not data:
                    break
                self.chunk(data)
            self.end_stream()
        finally:
            # Si el navegador cortó (cancelar descarga), cerrar aquí cancela también la operación en Ollama.
            conn.close()

    # -- API propia del panel

    def panel(self, rest, query):
        m = self.command
        if rest == "system" and m == "GET":
            return self.send_json(200, system_info())
        if rest == "logs" and m == "GET":
            lines = max(10, min(2000, int(query.get("lines", ["200"])[0])))
            return self.send_json(200, ollama_logs(lines))
        if rest == "upload" and m == "POST":
            return self.upload_gguf(query)
        if rest == "datasets":
            if m == "GET":
                return self.send_json(200, {"datasets": self.list_datasets()})
            if m == "POST":
                return self.upload_dataset(query)
        if rest.startswith("datasets/") and m == "DELETE":
            name = rest[len("datasets/"):]
            if not FILE_NAME_RE.match(name):
                return self.fail(400, "Nombre inválido.")
            os.remove(os.path.join(DATASETS, name))
            return self.send_json(200, {"ok": True})
        if rest == "train/env" and m == "GET":
            return self.send_json(200, train_env())
        if rest == "train" and m == "POST":
            return self.send_json(200, jobs.start(parse_train_request(self.read_json())))
        if rest == "quantize/env" and m == "GET":
            return self.send_json(200, quantize_env())
        if rest == "quantize" and m == "POST":
            return self.send_json(200, jobs.start(parse_quantize_request(self.read_json()), kind="quantize"))
        if rest == "access" and m == "GET":
            env = ollama_service_env() or {}
            return self.send_json(200, {"keys": keys.public(), "password_set": bool(PASSWORD), "tls": bool(TLS_CERT),
                                        "port": PORT, "ollama_host": env.get("OLLAMA_HOST"), "ollama_env_known": bool(env),
                                        "same_host": SAME_HOST})
        if rest == "keys" and m == "POST":
            secret, rec = keys.create(self.read_json().get("name"))
            return self.send_json(200, {"key": secret, "record": rec})
        km = re.match(r"^keys/([0-9a-f]{8})$", rest)
        if km and m == "DELETE":
            keys.revoke(km.group(1))
            return self.send_json(200, {"ok": True})
        if rest == "update" and m == "GET":
            return self.send_json(200, updater.info())
        if rest == "update/check" and m == "POST":
            return self.send_json(200, updater.check())
        if rest == "update/apply" and m == "POST":
            return self.send_json(200, updater.apply(force=bool(self.read_json().get("force"))))
        if rest == "settings" and m == "POST":
            return self.send_json(200, save_settings(self.read_json()))
        if rest == "engines/env" and m == "GET":
            return self.send_json(200, engine_env())
        if rest == "engines":
            if m == "GET":
                return self.send_json(200, {"instances": engines.list()})
            if m == "POST":
                return self.send_json(200, engines.start(self.read_json()))
        em = re.match(r"^engines/([0-9a-f]{8})(/stop|/log)?$", rest)
        if em:
            inst_id, action = em.group(1), em.group(2)
            if action == "/stop" and m == "POST":
                engines.stop(inst_id)
                return self.send_json(200, {"ok": True})
            if action == "/log" and m == "GET":
                return self.send_json(200, engines.log(inst_id, max(0, int(query.get("offset", ["0"])[0]))))
            if action is None and m == "DELETE":
                engines.remove(inst_id)
                return self.send_json(200, {"ok": True})
        if rest == "jobs" and m == "GET":
            kind = query.get("kind", [None])[0]
            return self.send_json(200, {"jobs": jobs.list(kind)})
        jm = re.match(r"^jobs/([0-9a-f\-]+)(/log|/cancel)?$", rest)
        if jm:
            job_id, action = jm.group(1), jm.group(2)
            if action == "/log" and m == "GET":
                return self.send_json(200, jobs.log(job_id, max(0, int(query.get("offset", ["0"])[0]))))
            if action == "/cancel" and m == "POST":
                return self.send_json(200, {"ok": jobs.cancel(job_id)})
            if action is None and m == "DELETE":
                jobs.delete(job_id)
                return self.send_json(200, {"ok": True})
        self.fail(404, "Ruta desconocida.")

    def receive_file(self, dest, limit=None):
        """Guarda el cuerpo de la petición en dest. Devuelve (sha256, bytes)."""
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("Archivo vacío o sin Content-Length.")
        if limit and length > limit:
            raise ValueError("Archivo demasiado grande.")
        self.body_read = True
        digest = hashlib.sha256()
        remaining = length
        with open(dest, "wb") as out:
            while remaining:
                data = self.rfile.read(min(1 << 20, remaining))
                if not data:
                    raise ConnectionResetError("subida interrumpida")
                out.write(data)
                digest.update(data)
                remaining -= len(data)
        return digest.hexdigest(), length

    def upload_gguf(self, query):
        """Recibe un GGUF, lo registra como blob en Ollama y responde con su digest (NDJSON de progreso)."""
        free = shutil.disk_usage(UPLOADS).free
        length = int(self.headers.get("Content-Length") or 0)
        if length > free:
            self.close_connection = True
            return self.fail(507, "No hay espacio en disco en el panel para recibir el archivo.")
        tmp = os.path.join(UPLOADS, uuid.uuid4().hex + ".part")
        try:
            sha, size = self.receive_file(tmp)
            digest = "sha256:" + sha
            self.start_stream()
            conn = upstream()
            try:
                conn.request("HEAD", "/api/blobs/" + digest)
                resp = conn.getresponse()
                resp.read()
                exists = resp.status == 200
            finally:
                conn.close()
            if not exists:
                def blocks():
                    sent = 0
                    last = 0.0
                    with open(tmp, "rb") as f:
                        while True:
                            data = f.read(1 << 20)
                            if not data:
                                break
                            sent += len(data)
                            if time.time() - last > 0.4:
                                last = time.time()
                                self.line({"status": "Registrando en Ollama", "completed": sent, "total": size})
                            yield data
                conn = upstream()
                try:
                    conn.request("POST", "/api/blobs/" + digest, body=blocks(),
                                 headers={"Content-Length": str(size), "Content-Type": "application/octet-stream"})
                    resp = conn.getresponse()
                    detail = resp.read().decode("utf-8", "replace")
                    if resp.status not in (200, 201):
                        self.line({"error": "Ollama rechazó el archivo (%s): %s" % (resp.status, detail[:300])})
                        return self.end_stream()
                finally:
                    conn.close()
            self.line({"status": "success", "digest": digest, "size": size})
            self.end_stream()
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def list_datasets(self):
        out = []
        for name in sorted(os.listdir(DATASETS)):
            path = os.path.join(DATASETS, name)
            if os.path.isfile(path):
                out.append({"name": name, "size": os.path.getsize(path), "modified": os.path.getmtime(path)})
        return out

    def upload_dataset(self, query):
        name = query.get("name", [""])[0]
        if not FILE_NAME_RE.match(name) or not name.endswith(".jsonl"):
            return self.fail(400, "El dataset debe ser un archivo .jsonl con nombre simple (letras, números, guiones).")
        dest = os.path.join(DATASETS, name)
        tmp = dest + ".part"
        try:
            self.receive_file(tmp, limit=4 << 30)
            report = validate_dataset(tmp)
            if not report["examples"]:
                return self.send_json(400, {"error": "El archivo no contiene ejemplos válidos.", "report": report})
            os.replace(tmp, dest)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        self.send_json(200, {"name": name, "report": report})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server():
    srv = Server((HOST, PORT), Handler)
    if TLS_CERT and TLS_KEY:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(TLS_CERT, TLS_KEY)
        # El saludo TLS se hace en el hilo de cada conexión, no en el que acepta: un cliente lento no bloquea al resto.
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True, do_handshake_on_connect=False)
    return srv


if __name__ == "__main__":
    print("Panel IA Server en %s://%s:%d  ->  %s%s" % (
        "https" if TLS_CERT and TLS_KEY else "http", HOST, PORT, OLLAMA_URL,
        "  (con contraseña)" if PASSWORD else "  (SIN contraseña)"), flush=True)
    import signal

    def on_sigterm(*_):
        raise KeyboardInterrupt  # systemctl stop: sale del bucle y cierra las instancias de llama-server

    signal.signal(signal.SIGTERM, on_sigterm)
    threading.Thread(target=updater.loop, daemon=True).start()
    try:
        make_server().serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        engines.stop_all()
