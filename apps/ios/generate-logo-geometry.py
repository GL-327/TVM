#!/usr/bin/env python3
"""The iOS intro's logo geometry (TVM/TVMLogoGeometry.swift), generated from
Android's TvmLogoGeometry.kt, so both apps draw the identical logo."""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
KOTLIN = os.path.join(ROOT, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'tvm', 'privateclient', 'TvmLogoGeometry.kt')
src = open(KOTLIN).read()
out = ['import CoreGraphics', '',
       "/// The TVM logo as vectors, generated from Android's TvmLogoGeometry.kt (the same",
       '/// trace of apps/brand/tvm-icon.png), so both apps draw the identical logo.',
       '/// Regenerate with apps/ios/generate-logo-geometry.py after changing it there.',
       'enum TVMLogoGeometry {', '    static let size: CGFloat = 1024',
       '    static let gradientStops: [CGFloat] = [0, 0.25, 0.5, 0.75, 1.0]',
       '    static let gradientColors: [UInt32] = [0x5714FD, 0x3443FD, 0x177FFD, 0x08B1FC, 0x00DFFD]']
for name in ['letterT', 'letterV', 'letterM', 'trailLower', 'trailRight', 'trailUpper', 'centreLower', 'centreRight', 'centreUpper']:
    m = re.search(r'val ' + name + r' = floatArrayOf\(([^)]*)\)', src)
    nums = [x.strip().rstrip('f') for x in m.group(1).replace('\n', ' ').split(',') if x.strip()]
    lines = ['        ' + ', '.join(nums[i:i + 12]) + ',' for i in range(0, len(nums), 12)]
    out.append('    static let %s: [CGFloat] = [\n%s\n    ]' % (name, '\n'.join(lines)))
for name, swift in [('STAR_X', 'starX'), ('STAR_Y', 'starY'), ('STAR_UP', 'starUp'), ('STAR_DOWN', 'starDown'), ('STAR_SIDE', 'starSide'), ('STAR_PINCH', 'starPinch')]:
    m = re.search(r'const val ' + name + r' = ([0-9.]+)f', src)
    out.append('    static let %s: CGFloat = %s' % (swift, m.group(1)))
out.append('}')
open(os.path.join(ROOT, 'TVM', 'TVMLogoGeometry.swift'), 'w').write('\n'.join(out) + '\n')
print('TVMLogoGeometry.swift written')
