#!/usr/bin/env python3
"""Recuantiza el GGUF de un modelo de Ollama con llama-quantize y lo registra como modelo nuevo.

Las versiones recientes de Ollama (comprobado en la 0.40.16) solo cuantizan al importar safetensors;
para un modelo GGUF ya instalado hace falta llama.cpp. Este script, lanzado por el panel en la misma máquina que Ollama:
  1. lee de /api/show la ruta del blob GGUF y la plantilla, sistema y parámetros del original,
  2. ejecuta llama-quantize hacia un archivo temporal,
  3. sube el resultado como blob y crea el modelo con la misma plantilla y parámetros.
Solo usa la biblioteca estándar.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request


def log(msg):
    print(msg, flush=True)


def call(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=3600) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise SystemExit("Ollama respondió %s en %s: %s" % (e.code, path, e.read().decode("utf-8", "replace")[:400]))


def parse_parameters(text):
    """Convierte el bloque 'parameters' de /api/show ("clave valor" por línea) en un dict para /api/create."""
    out = {}
    for line in (text or "").splitlines():
        m = re.match(r"^\s*(\S+)\s+(.+?)\s*$", line)
        if not m:
            continue
        key, raw = m.group(1), m.group(2)
        if raw.startswith('"') and raw.endswith('"'):
            raw = raw[1:-1]
        try:
            value = json.loads(raw) if re.match(r"^-?\d+(\.\d+)?$|^(true|false)$", raw) else raw
        except ValueError:
            value = raw
        if key == "stop":
            out.setdefault("stop", []).append(value)
        else:
            out[key] = value
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    with open(parser.parse_args().config, encoding="utf-8") as f:
        cfg = json.load(f)["config"]
    base = cfg["ollama_url"]

    show = json.loads(call(base, "/api/show", {"model": cfg["from"]}))
    m = re.search(r"^FROM\s+(\S*sha256[-:]([0-9a-f]{64}))\s*$", show.get("modelfile", ""), re.M)
    if not m:
        raise SystemExit("No encuentro el archivo GGUF de %s en su Modelfile." % cfg["from"])
    src = m.group(1)
    if not os.path.isfile(src):
        raise SystemExit("El blob %s no es accesible desde el panel. ¿Corre en la misma máquina que Ollama "
                         "y el usuario del panel puede leer la carpeta de modelos?" % src)
    if re.search(r"^ADAPTER\s", show.get("modelfile", ""), re.M):
        log("Aviso: el modelo tiene un adaptador LoRA; se cuantiza solo la base y el adaptador no se copia.")

    out = os.path.join(cfg["job_dir"], "quantized.gguf")
    cmd = [cfg["llama_quantize"]]
    if cfg.get("allow_requantize"):
        cmd.append("--allow-requantize")
    cmd += [src, out, cfg["type"]]
    if cfg.get("threads"):
        cmd.append(str(cfg["threads"]))
    log("$ " + " ".join(cmd))
    code = subprocess.call(cmd)
    if code != 0:
        raise SystemExit("llama-quantize terminó con código %d." % code)
    size = os.path.getsize(out)
    log("Archivo cuantizado: %.2f GB" % (size / 1e9))

    log("Calculando la firma y registrando el blob en Ollama…")
    sha = hashlib.sha256()
    with open(out, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            sha.update(block)
    digest = "sha256:" + sha.hexdigest()
    with open(out, "rb") as f:
        req = urllib.request.Request(base + "/api/blobs/" + digest, data=f, method="POST",
                                     headers={"Content-Length": str(size)})
        urllib.request.urlopen(req, timeout=3600).read()

    body = {"model": cfg["output"], "files": {"model.gguf": digest}, "stream": False}
    if show.get("template"):
        body["template"] = show["template"]
    if show.get("system"):
        body["system"] = show["system"]
    params = parse_parameters(show.get("parameters"))
    if params:
        body["parameters"] = params
    call(base, "/api/create", body)
    os.remove(out)
    log("Modelo %s creado en Ollama (%s)." % (cfg["output"], cfg["type"]))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
