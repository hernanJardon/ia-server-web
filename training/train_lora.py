#!/usr/bin/env python3
"""Fine-tuning LoRA lanzado por el panel.

Pasos: valida el dataset, entrena un adaptador LoRA sobre el modelo base de Hugging Face
y lo registra en Ollama como un modelo nuevo (modelo de Ollama + adaptador).

Las dependencias pesadas (torch, transformers, peft) se importan solo al entrenar, de modo
que la validación y el modo de prueba funcionan con la biblioteca estándar.

Formatos de dataset (.jsonl, un ejemplo por línea):
  {"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
  {"instruction": "...", "input": "(opcional)", "output": "..."}
  {"prompt": "...", "response": "..."}
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROLES = ("system", "user", "assistant", "tool")


def to_messages(obj):
    """Normaliza un ejemplo a una lista de mensajes de chat. Lanza ValueError si no encaja."""
    if not isinstance(obj, dict):
        raise ValueError("la línea no es un objeto JSON")
    if "messages" in obj:
        msgs = obj["messages"]
        if not isinstance(msgs, list) or len(msgs) < 2:
            raise ValueError("'messages' debe tener al menos dos mensajes")
        for m in msgs:
            if not isinstance(m, dict) or m.get("role") not in ROLES or not isinstance(m.get("content"), str):
                raise ValueError("cada mensaje necesita 'role' válido y 'content' de texto")
        if msgs[-1]["role"] != "assistant":
            raise ValueError("el último mensaje debe ser del asistente")
        return msgs
    if "instruction" in obj and "output" in obj:
        user = str(obj["instruction"])
        if obj.get("input"):
            user += "\n\n" + str(obj["input"])
        return [{"role": "user", "content": user}, {"role": "assistant", "content": str(obj["output"])}]
    if "prompt" in obj and "response" in obj:
        return [{"role": "user", "content": str(obj["prompt"])},
                {"role": "assistant", "content": str(obj["response"])}]
    raise ValueError("formato no reconocido (se espera messages, instruction/output o prompt/response)")


def read_examples(path):
    """Devuelve (ejemplos, errores). errores = lista de (número de línea, motivo)."""
    examples, errors = [], []
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        for n, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                examples.append(to_messages(json.loads(line)))
            except ValueError as e:
                errors.append((n, str(e)))
    return examples, errors


def validate_dataset(path):
    examples, errors = read_examples(path)
    chars = sum(len(m["content"]) for ex in examples for m in ex)
    return {"examples": len(examples), "invalid": len(errors),
            "errors": [{"line": n, "reason": r} for n, r in errors[:5]],
            "avg_chars": round(chars / len(examples)) if examples else 0}


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- entrenamiento

def train(cfg, examples, adapter_dir):
    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (AutoModelForCausalLM, AutoTokenizer, DataCollatorForLanguageModeling,
                              Trainer, TrainingArguments)

    if not torch.cuda.is_available():
        raise SystemExit("No hay GPU CUDA disponible para este intérprete. El entrenamiento en CPU no es viable.")
    log("GPU: %s" % torch.cuda.get_device_name(0))

    tok = AutoTokenizer.from_pretrained(cfg["base_model"])
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    if not tok.chat_template:
        raise SystemExit("El tokenizer del modelo base no trae plantilla de chat; usa una variante 'instruct' o 'chat'.")

    kwargs = {"device_map": "auto"}
    if cfg["load_4bit"]:
        from transformers import BitsAndBytesConfig
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16)
    else:
        import transformers
        major = int(transformers.__version__.split(".")[0])
        kwargs["dtype" if major >= 5 else "torch_dtype"] = torch.bfloat16
    log("Cargando modelo base %s ..." % cfg["base_model"])
    model = AutoModelForCausalLM.from_pretrained(cfg["base_model"], **kwargs)
    if cfg["load_4bit"]:
        model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, LoraConfig(
        r=cfg["lora_r"], lora_alpha=cfg["lora_alpha"], lora_dropout=0.05,
        target_modules="all-linear", task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    rows, truncated = [], 0
    for msgs in examples:
        text = tok.apply_chat_template(msgs, tokenize=False)
        ids = tok(text, add_special_tokens=False)["input_ids"]
        if len(ids) > cfg["max_seq_len"]:
            ids = ids[:cfg["max_seq_len"]]
            truncated += 1
        rows.append({"input_ids": ids, "attention_mask": [1] * len(ids)})
    if truncated:
        log("Aviso: %d de %d ejemplos superan max_seq_len y se truncaron." % (truncated, len(rows)))

    args = TrainingArguments(
        output_dir=os.path.join(cfg["job_dir"], "checkpoints"),
        num_train_epochs=cfg["epochs"], learning_rate=cfg["learning_rate"],
        per_device_train_batch_size=cfg["batch_size"], gradient_accumulation_steps=cfg["grad_accum"],
        logging_steps=5, save_strategy="no", report_to=[], bf16=True,
        lr_scheduler_type="cosine", warmup_ratio=0.05, disable_tqdm=True)
    trainer = Trainer(model=model, args=args, train_dataset=rows,
                      data_collator=DataCollatorForLanguageModeling(tok, mlm=False))
    trainer.train()
    model.save_pretrained(adapter_dir)
    log("Adaptador guardado en %s" % adapter_dir)


# ---------------------------------------------------------------- registro en Ollama

def push_blob(base_url, path):
    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            sha.update(block)
    digest = "sha256:" + sha.hexdigest()
    with open(path, "rb") as f:
        req = urllib.request.Request("%s/api/blobs/%s" % (base_url, digest), data=f, method="POST",
                                     headers={"Content-Length": str(os.path.getsize(path))})
        urllib.request.urlopen(req, timeout=3600).read()
    return digest


def register(cfg, adapter_dir):
    files = {}
    if cfg.get("llama_cpp_dir"):
        gguf = os.path.join(cfg["job_dir"], "adapter.gguf")
        cmd = [sys.executable, os.path.join(cfg["llama_cpp_dir"], "convert_lora_to_gguf.py"),
               "--outfile", gguf, "--outtype", "f16"]
        cmd += ["--base", cfg["base_model"]] if os.path.isdir(cfg["base_model"]) \
            else ["--base-model-id", cfg["base_model"]]
        log("Convirtiendo adaptador a GGUF con llama.cpp ...")
        subprocess.run(cmd + [adapter_dir], check=True)
        files["adapter.gguf"] = push_blob(cfg["ollama_url"], gguf)
    else:
        log("LLAMA_CPP_DIR no definido: se envía el adaptador en safetensors "
            "(Ollama solo lo admite para algunas arquitecturas).")
        for name in ("adapter_model.safetensors", "adapter_config.json"):
            files[name] = push_blob(cfg["ollama_url"], os.path.join(adapter_dir, name))
    body = json.dumps({"model": cfg["output_model"], "from": cfg["ollama_from"], "adapters": files}).encode()
    req = urllib.request.Request(cfg["ollama_url"] + "/api/create", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=3600) as resp:
            for raw in resp:
                msg = json.loads(raw)
                if msg.get("error"):
                    raise SystemExit("Ollama no pudo crear el modelo: %s" % msg["error"])
                log("ollama: %s" % msg.get("status", ""))
    except urllib.error.HTTPError as e:
        raise SystemExit("Ollama no pudo crear el modelo (%s): %s" % (e.code, e.read().decode("utf-8", "replace")))
    log("Modelo %s creado en Ollama." % cfg["output_model"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="job.json escrito por el panel")
    with open(parser.parse_args().config, encoding="utf-8") as f:
        cfg = json.load(f)["config"]

    examples, errors = read_examples(cfg["dataset"])
    log("Dataset %s: %d ejemplos válidos, %d líneas descartadas." % (cfg["dataset_name"], len(examples), len(errors)))
    for n, reason in errors[:10]:
        log("  línea %d: %s" % (n, reason))
    if not examples:
        raise SystemExit("No hay ejemplos válidos.")
    if cfg.get("dry_run"):
        log("Modo prueba: dataset correcto, no se entrena.")
        return

    adapter_dir = os.path.join(cfg["job_dir"], "adapter")
    train(cfg, examples, adapter_dir)
    register(cfg, adapter_dir)


if __name__ == "__main__":
    main()
