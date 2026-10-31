"""Rend le modèle CenterFace de deface utilisable avec onnxruntime-web.

Le fichier d'origine a une entrée fixe 10x3x32x32 et déclare chaque poids comme
entrée du graphe, ce qui fait protester ONNX Runtime et empêche de traiter des
images de taille quelconque. Ce script rend lot/hauteur/largeur dynamiques et
retire les initialiseurs des entrées.

    pip install onnx
    curl -L -o centerface.onnx https://raw.githubusercontent.com/ORB-HD/deface/master/deface/centerface.onnx
    python tools/convert_model.py centerface.onnx public/models/centerface-dynamic.onnx
"""
import sys

import onnx
from onnx.tools.update_model_dims import update_inputs_outputs_dims


def dims(values):
    return {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim] for v in values}


def main(src: str, dst: str) -> None:
    model = onnx.load(src)
    inputs, outputs = dims(model.graph.input), dims(model.graph.output)
    inputs['input.1'] = ['B', 3, 'H', 'W']
    outputs.update({
        '537': ['B', 1, 'h', 'w'],   # carte de chaleur
        '538': ['B', 2, 'h', 'w'],   # échelle
        '539': ['B', 2, 'h', 'w'],   # décalage
        '540': ['B', 10, 'h', 'w'],  # points de repère
    })
    model = update_inputs_outputs_dims(model, inputs, outputs)

    weights = {i.name for i in model.graph.initializer}
    real_inputs = [i for i in model.graph.input if i.name not in weights]
    del model.graph.input[:]
    model.graph.input.extend(real_inputs)

    onnx.checker.check_model(model)
    onnx.save(model, dst)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
