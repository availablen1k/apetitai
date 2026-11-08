"""Portable model-package paths; the challenge dataset is an external dependency."""
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATASET_NAME='APETIT_CLIMATE_NATURE_NAVIGATOR_2026'
configured=os.environ.get('APETIT_DATA_DIR')
# Default: the nearest ancestor folder holding the dataset (beside this folder, or beside the
# TraceFlow app that contains it). If none exists, the sibling path is reported by the preflight.
_found=next((p/DATASET_NAME for p in ROOT.parents if (p/DATASET_NAME/'data').is_dir()),ROOT.parent/DATASET_NAME)
DATA=(Path(configured).expanduser() if configured else _found/'data').resolve()


def code_reference(path,data=DATA):
    """Portable identity for model code or original challenge reference code."""
    path=path.resolve()
    if path.is_relative_to(ROOT):return str(path.relative_to(ROOT))
    dataset_root=data.resolve().parent
    if path.is_relative_to(dataset_root):return 'dataset/'+str(path.relative_to(dataset_root))
    raise ValueError('Code outside the model package and challenge dataset: '+str(path))


def resolve_code_reference(reference,data=DATA):
    return data.parent/reference.removeprefix('dataset/') if reference.startswith('dataset/') else ROOT/reference
