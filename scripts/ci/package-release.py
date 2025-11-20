#!/usr/bin/env python3
"""Package SIDFlow release by staging files for archiving.

This script prepares a release by copying the repository contents
(excluding .git) to a staging directory. The calling workflow script
handles zip creation from the staged files. Designed for CI/CD workflows.

The script expects two environment variables:
- SRC_DIR: Source directory containing the repository files
- TARGET_DIR: Destination directory where files will be staged
"""

from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import sys


def ignore_patterns(_directory: str, entries: list[str]) -> list[str]:
    """Return list of entries to ignore during copy.
    
    Args:
        _directory: The directory being copied (unused, required by shutil.copytree)
        entries: List of files/directories in the directory
        
    Returns:
        List of entry names to ignore
    """
    ignored = {'.git'}
    return [name for name in entries if name in ignored]


def package_release(src_dir: pathlib.Path, target_dir: pathlib.Path) -> None:
    """Copy repository files to target directory, excluding .git.
    
    Args:
        src_dir: Source directory containing repository files
        target_dir: Destination directory for packaged files
        
    Raises:
        FileNotFoundError: If source directory doesn't exist
        NotADirectoryError: If source path is not a directory
        PermissionError: If insufficient permissions to read/write
        shutil.Error: If errors occur during the copy operation
        OSError: For other filesystem errors
    """
    src = src_dir.resolve()
    dst = target_dir.resolve()
    
    if not src.exists():
        raise FileNotFoundError(f"Source directory not found: {src}")
    
    if not src.is_dir():
        raise NotADirectoryError(f"Source path is not a directory: {src}")
    
    # Remove target if it exists
    if dst.exists():
        shutil.rmtree(dst)
    
    # Copy with ignore filter
    shutil.copytree(src, dst, ignore=ignore_patterns)


def main(argv: list[str]) -> int:
    """Main entry point for the packaging script.
    
    Args:
        argv: Command line arguments
        
    Returns:
        Exit code (0 for success, non-zero for errors)
    """
    parser = argparse.ArgumentParser(
        description='Package SIDFlow release as a zip archive',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '--src-dir',
        type=pathlib.Path,
        default=os.environ.get('SRC_DIR'),
        help='Source directory (defaults to SRC_DIR environment variable)'
    )
    parser.add_argument(
        '--target-dir',
        type=pathlib.Path,
        default=os.environ.get('TARGET_DIR'),
        help='Target directory (defaults to TARGET_DIR environment variable)'
    )
    
    args = parser.parse_args(argv)
    
    if not args.src_dir:
        print("Error: --src-dir must be provided or SRC_DIR environment variable must be set", 
              file=sys.stderr)
        return 1
    
    if not args.target_dir:
        print("Error: --target-dir must be provided or TARGET_DIR environment variable must be set",
              file=sys.stderr)
        return 1
    
    try:
        package_release(args.src_dir, args.target_dir)
        print(f"Successfully packaged release from {args.src_dir} to {args.target_dir}")
        return 0
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except NotADirectoryError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except PermissionError as exc:
        print(f"Permission error: {exc}", file=sys.stderr)
        return 1
    except shutil.Error as exc:
        print(f"Copy error: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Filesystem error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
