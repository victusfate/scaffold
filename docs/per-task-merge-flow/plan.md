# Plan

One cohesive slice: implement persistent selection and acknowledgment across the
model, CLI and console; document the root's PR/merge cycle and batch opt-in.

1. RED: model and real CLI tests for selection, failure, completion, restart,
   acknowledgment and batch compatibility.
2. GREEN: shared model gate and CLI acknowledgment, docs and migration guidance.
3. Review correctness/quality, run full local verification, open upstream PR.

Scope and granularity follow the owner's explicit bounded implementation request.
