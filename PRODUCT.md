# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: backend en Python solo con biblioteca estándar (para instalarlo en el servidor sin dependencias) y frontend en HTML/CSS/JS sin paso de build. El usuario pidió "un panel web" sin fijar tecnología; la elección es del agente y está pendiente de que el usuario la objete.

## Users

Una sola persona: el dueño de un servidor Linux doméstico en su red local con Ollama y 4 GPU NVIDIA de 12 GB. Hoy lo administra por SSH y le resulta incómodo. Usa el panel desde el navegador de su PC en la misma red local.

## Product Purpose

Sustituir las tareas habituales de SSH por un panel web: ver los modelos instalados, descargarlos, subir archivos GGUF, cargar y descargar modelos de memoria, cuantizarlos, crear variantes y entrenar adaptadores LoRA. Éxito: no necesitar abrir una terminal para el trabajo diario con modelos.

## Operating Context

El panel corre en la misma máquina Linux que Ollama (confirmado por el usuario) y habla con su API local. Las operaciones son largas (descargas de decenas de GB, cuantización, entrenamiento) y el recurso escaso es la memoria de vídeo: 4 tarjetas de 12 GB.

## Capabilities and Constraints

- Todo lo relativo a modelos pasa por la API HTTP de Ollama (versión observada: 0.30.7).
- Ollama solo cuantiza a partir de modelos F16/F32; un modelo ya cuantizado no se puede recuantizar.
- Ollama no entrena: el entrenamiento LoRA lo ejecuta un script aparte con PyTorch y exige el modelo base de Hugging Face, no el GGUF de Ollama.
- Las versiones recientes de Ollama (0.40.16 en el servidor) ya no cuantizan GGUF instalados; el panel usa llama-quantize.
- Ollama no permite elegir GPU por modelo. Para eso el panel lanza motores aparte (llama.cpp con el GGUF de Ollama, vLLM con modelos de Hugging Face).
- Sin decidir: si el panel llevará contraseña (es opcional por variable de entorno).

## Evidence on Hand

Datos reales del servidor a través de la API (modelos, tamaños, cuantización, memoria en uso). No hay marca, logotipo ni nombre de producto: no inventarlos.

## Product Principles

1. Lo que hay en memoria y lo que cabe es la información más valiosa: siempre visible.
2. Toda operación larga muestra progreso real y se puede cancelar.
3. Las acciones destructivas (borrar un modelo) piden confirmación explícita.
4. El panel dice la verdad sobre los límites de Ollama en lugar de ofrecer controles que fallarán.
