#!/usr/bin/env bash
set -euo pipefail
bash verify-430/reconstruct-final.sh
base64 -d verify-430/keyboard-activation-fix.patch.xz.b64 > /tmp/keyboard-activation-fix.patch.xz
xz -dc /tmp/keyboard-activation-fix.patch.xz > /tmp/keyboard-activation-fix.patch
(cd verify-430 && patch -p1 --batch < /tmp/keyboard-activation-fix.patch)
echo 'a414aa516a00adf4c2ae522c1e393c1de816bfb316e5efea75eeedfab3783605  verify-430/LifeOS.html' | sha256sum -c -
python3 - <<'PY'
from pathlib import Path
import re
source=Path('verify-430/LifeOS.html').read_text(); pwa=Path('verify-430/pwa')
(pwa/'app.js').write_text(re.search(r'<script>\n?(.*?)\n?</script>',source,re.S).group(1)+'\n')
PY
echo '6088570295c543c973eecb2d82efb8eacd7685f3ae4c895ee807b1cc29ffced8  verify-430/pwa/app.js' | sha256sum -c -
echo '205cc8db8ac2d960bfb027ae9bd21e5fa6748ce88d1816ada6f5bf3639affc57  verify-430/pwa/app.css' | sha256sum -c -
echo '1278d641d555735ed80192e3b303643143f079c5d3db6f2afdcf1a638554c156  verify-430/pwa/index.html' | sha256sum -c -
echo '133b8b268323c76efd6cfaa65c7101ecc56e1349f54c2b5f0d23dce53b367941  verify-430/pwa/manifest.webmanifest' | sha256sum -c -
echo '13f8e77a2513685d661bc320e700e180a462dba55a7de728f05be05d63cc47ca  verify-430/pwa/service-worker.js' | sha256sum -c -
echo 'e07357e200c62feb9601b5be7d45759de61d7740a15dcb60ecdd204c54b9d134  verify-430/pwa/planning-worker.js' | sha256sum -c -
