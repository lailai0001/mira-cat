#!/usr/bin/env python3
"""
mira-cat bundle 构建脚本

原理：
- 基础包为 fangkuia/XPTV 的 dist/index.js（CatPawOpen "shan" 框架服务端 bundle）
- 包内 spider 通过 fH() 注册表注册：return[...t,...s,jq,xq]
- 其中 jq = liveSource（📺 直播源），xq = qrcode（配置页面）
- 本脚本将 jq、xq 从注册表移除，生成不含直播源和配置页面的新包

用法：
    python3 scripts/patch_bundle.py <input_bundle.js> <output_bundle.js>

输出：
    <output_bundle.js> 和 <output_bundle.js.md5>
"""
import sys
import hashlib


# 注册表中要排除的 spider 变量名
EXCLUDE_SPIDERS = ['jq', 'xq']  # jq=liveSource(📺直播源), xq=qrcode(配置页面)

# 注册表原始片段（fangkuia 包，esbuild minify 格式）
REGISTRY_OLD = 'return[...t,...s,jq,xq]'
REGISTRY_NEW = 'return[...t,...s]'


def patch(input_path, output_path):
    with open(input_path, 'r', encoding='utf-8', errors='ignore') as f:
        data = f.read()

    count = data.count(REGISTRY_OLD)
    if count != 1:
        print(f"ERROR: 注册表片段出现 {count} 次（期望 1 次），中止")
        sys.exit(1)

    patched = data.replace(REGISTRY_OLD, REGISTRY_NEW)

    # 确认排除的 spider 不再出现在注册表中
    assert 'jq,xq]' not in patched, "注册表中仍有 jq,xq"

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(patched)

    with open(output_path, 'rb') as f:
        md5 = hashlib.md5(f.read()).hexdigest()
    with open(output_path + '.md5', 'w') as f:
        f.write(md5)

    print(f"OK: {output_path} ({len(patched)} chars)")
    print(f"MD5: {md5}")
    print(f"已排除: {', '.join(EXCLUDE_SPIDERS)}")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2])
