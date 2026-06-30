import os
import sys

import gyp_action_lib as lib


scripts = {
    "make": [os.environ.get("NODE", "node"), ".gyp/node-make.js"],
    "dist": [os.environ.get("NODE", "node"), ".gyp/node-dist.js"],
}

argv = lib.extract_argv()
if not argv or argv[0] not in scripts:
    sys.stderr.write(f"unsupported node action: {' '.join(argv)}{os.linesep}")
    sys.exit(1)

lib.run([*scripts[argv[0]], *argv[1:]])
