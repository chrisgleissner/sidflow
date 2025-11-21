#!/usr/bin/env python3
"""Package SIDFlow release directly to a zip with aggressive pruning.

This script walks the repo and writes a zip archive with a single top-level
folder (archive_name). It excludes heavy/non-runtime paths to avoid disk
exhaustion on CI runners and preserves symlinks without dereferencing.

Environment variables:
- SRC_DIR: Source directory (default: repo root)
- ARCHIVE_NAME: Folder name inside the zip (default: sidflow-release)
- ZIP_PATH: Destination zip path (default: <SRC_DIR>/<ARCHIVE_NAME>.zip)
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys
import zipfile
from typing import Iterable

IGNORED_DIRS = {
    ".git",
    ".bun",
    ".turbo",
    "workspace",
    "performance",
    "data",
    "doc",
    "integration-tests",
    "test-data",
    "coverage",
    "tmp",
    "test-results",
    "test-workspace",
}

IGNORED_PATH_PREFIXES = {
    pathlib.PurePosixPath("packages/sidflow-web/.next/cache"),
    pathlib.PurePosixPath("node_modules/.cache"),
}


def should_skip_dir(rel_dir: pathlib.PurePosixPath) -> bool:
    if rel_dir.name in IGNORED_DIRS:
        return True
    for prefix in IGNORED_PATH_PREFIXES:
        if rel_dir.as_posix().startswith(prefix.as_posix()):
            return True
    return False


def add_file_to_zip(zipf: zipfile.ZipFile, abs_path: pathlib.Path, arc_path: pathlib.PurePosixPath) -> None:
    if abs_path.is_symlink():
        info = zipfile.ZipInfo(str(arc_path))
        info.create_system = 3  # Unix
        info.external_attr = 0o120755 << 16  # Symlink
        target = os.readlink(abs_path)
        zipf.writestr(info, target)
        return
    zipf.write(abs_path, arcname=str(arc_path), compress_type=zipfile.ZIP_DEFLATED)


def iter_files(src_root: pathlib.Path) -> Iterable[tuple[pathlib.Path, pathlib.PurePosixPath]]:
    for root, dirs, files in os.walk(src_root):
        rel_root = pathlib.Path(root).relative_to(src_root)
        rel_root_posix = pathlib.PurePosixPath(rel_root.as_posix())
        # Prune ignored dirs in-place to keep traversal small
        dirs[:] = [d for d in dirs if not should_skip_dir(rel_root_posix.joinpath(d))]
        if should_skip_dir(rel_root_posix):
            continue
        for name in files:
            rel_file = rel_root_posix.joinpath(name)
            # Skip accidental zips produced during packaging
            if rel_file.suffix == ".zip":
                continue
            yield pathlib.Path(root, name), rel_file


def package_release(src_dir: pathlib.Path, archive_name: str, zip_path: pathlib.Path) -> None:
    src = src_dir.resolve()
    if not src.exists():
        raise FileNotFoundError(f"Source directory not found: {src}")
    if not src.is_dir():
        raise NotADirectoryError(f"Source path is not a directory: {src}")

    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, strict_timestamps=False) as zipf:
        for abs_path, rel_posix in iter_files(src):
            arc_path = pathlib.PurePosixPath(archive_name).joinpath(rel_posix)
            add_file_to_zip(zipf, abs_path, arc_path)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Create a pruned release zip",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--src-dir",
        type=pathlib.Path,
        default=os.environ.get("SRC_DIR"),
        help="Source directory (defaults to SRC_DIR env or repo root)",
    )
    parser.add_argument(
        "--archive-name",
        type=str,
        default=os.environ.get("ARCHIVE_NAME", "sidflow-release"),
        help="Folder name inside the archive (defaults to ARCHIVE_NAME or sidflow-release)",
    )
    parser.add_argument(
        "--zip-path",
        type=pathlib.Path,
        default=os.environ.get("ZIP_PATH"),
        help="Zip output path (defaults to ZIP_PATH or <src-dir>/<archive-name>.zip)",
    )
    args = parser.parse_args(argv)

    try:
        if not args.src_dir:
            raise ValueError("SRC_DIR (--src-dir) is required")
        src_dir = args.src_dir
        archive_name = args.archive_name or "sidflow-release"
        zip_path = args.zip_path or src_dir.joinpath(f"{archive_name}.zip")
        package_release(src_dir, archive_name, zip_path)
        print(f"Successfully packaged release to {zip_path}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
