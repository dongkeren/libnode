{
  "variables": {
    "gyp_dir": "<(module_root_dir)/.gyp",
    "git_inputs": [
      "<(module_root_dir)/.gitmodules",
    ],
    "libnode_inputs": [
      "<(module_root_dir)/package.json",
      "<(module_root_dir)/libnode.release.json",
      "<(module_root_dir)/node/node.gyp",
    ],
    "module_inputs": [
      "<(module_root_dir)/src/cpp/link.cc",
      "<(module_root_dir)/src/js/index.js",
    ],
    "gyp_inputs": [
      "<(module_root_dir)/binding.gyp",
      "<(module_root_dir)/.gyp/gyp_action_lib.py",
      "<(module_root_dir)/.gyp/gyp_action_node.py",
      "<(module_root_dir)/.gyp/node-dist.js",
      "<(module_root_dir)/.gyp/node-make.js",
    ],
  },
  "targets": [
    {
      "target_name": "git",
      "type": "none",
      "actions": [
        {
          "action_name": "gitmodules",
          "inputs": [
            "<@(git_inputs)",
          ],
          "outputs": [
            "<(module_root_dir)/node/node.gyp",
          ],
          "action": [
            "python",
            "<(gyp_dir)/gyp_action_git.py",
            "submodule",
            "update",
            "--init"
          ]
        }
      ]
    },
    {
      "target_name": "libnode",
      "type": "none",
      "dependencies": [
        "git"
      ],
      "actions": [
        {
          "action_name": "libnode",
          "inputs": [
            "<@(libnode_inputs)",
          ],
          "outputs": [
            "<(PRODUCT_DIR)/libnodebuildinfo.json",
          ],
          "action": [
            "python",
            "<(gyp_dir)/gyp_action_node.py",
            "make",
          ]
        }
      ]
    },
    {
      "target_name": "<(module_name)",
      "dependencies": [
        "libnode",
      ],
      "sources": [
        "src/cpp/link.cc",
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ],
    },
    {
      "target_name": "dist",
      "type": "none",
      "dependencies": [
        "libnode",
        "<(module_name)",
      ],
      "actions": [
        {
          "action_name": "dist",
          "inputs": [
            "<@(libnode_inputs)",
            "<@(module_inputs)",
            "<@(gyp_inputs)",
          ],
          "outputs": [
            "<(module_root_dir)/dist/node/libnodebuildinfo.json",
          ],
          "action": [
            "python",
            "<(gyp_dir)/gyp_action_node.py",
            "dist",
          ]
        }
      ]
    }
  ]
}
