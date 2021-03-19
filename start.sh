#!/bin/sh

set -eu
set -o pipefail

source ./shared.sh

memory='4G'

sudo xhyve \
    -U "$uuid" \
    -A \
    -H \
    -m $memory \
    -c 2 \
    -s 0:0,hostbridge \
    -s 2:0,virtio-net \
    -s 4:0,virtio-blk,"$disk_img" \
    -s 31,lpc \
    -l com1,stdio \
    "$@"
