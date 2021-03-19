#!/bin/sh

set -eu
set -o pipefail

source ./shared.sh

./start.sh \
  -f fbsd,"$userboot","$disk_img","" "$@"
