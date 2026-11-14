#!/usr/bin/env python3
"""DEV-only read-only Docker image inventory. No removal operations."""
import json
import subprocess
from datetime import datetime, timezone

def run(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=45)

def json_lines(*args):
    return [json.loads(line) for line in run(*args).splitlines() if line.strip()]

containers = json_lines('ps', '-a', '--no-trunc', '--format', '{{json .}}')
tags_in_use = {str(c.get('Image', '')) for c in containers}
container_ids = [str(c.get('ID')) for c in containers if c.get('ID')]
# Failed inspection aborts generation rather than marking referenced images as free.
image_ids_in_use = (
    {str(c.get('Image', '')) for c in json.loads(run('inspect', *container_ids))}
    if container_ids else set()
)
items = []
for image in json_lines('image', 'ls', '-a', '--no-trunc', '--format', '{{json .}}'):
    tag = str(image.get('Repository', '<none>')) + ':' + str(image.get('Tag', '<none>'))
    in_use = tag in tags_in_use or image.get('ID') in image_ids_in_use
    items.append({
        'id': str(image.get('ID', '')),
        'name': tag,
        'sizeDisplay': str(image.get('Size', '')),
        'created': str(image.get('CreatedAt', '')),
        'protected': in_use,
        'reason': 'Referenced by a container' if in_use else 'Requires independent revalidation before deletion',
    })
print(json.dumps({
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'readOnly': True,
    'categories': [{'id': 'docker-images', 'title': 'Docker Images', 'items': items}],
}, ensure_ascii=False))
