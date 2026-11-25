' ISO/IEC 18004 QR Code encoder for BrightScript (Versions 1-9, Byte mode, EC Level M with L fallback).
' Matches apps/roku/scripts/qr.mjs bit-for-bit.

function qrVersionSpecs() as Object
  return [
    { version: 1, size: 21, ecLevel: "M", ecBits: 0, total: 26, data: 16, ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0, align: [] }
    { version: 2, size: 25, ecLevel: "M", ecBits: 0, total: 44, data: 28, ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0, align: [6, 18] }
    { version: 3, size: 29, ecLevel: "M", ecBits: 0, total: 70, data: 44, ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0, align: [6, 22] }
    { version: 4, size: 33, ecLevel: "M", ecBits: 0, total: 100, data: 64, ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0, align: [6, 26] }
    { version: 5, size: 37, ecLevel: "M", ecBits: 0, total: 134, data: 86, ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0, align: [6, 30] }
    { version: 6, size: 41, ecLevel: "M", ecBits: 0, total: 172, data: 108, ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0, align: [6, 34] }
    { version: 7, size: 45, ecLevel: "M", ecBits: 0, total: 196, data: 124, ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0, align: [6, 22, 38] }
    { version: 8, size: 49, ecLevel: "M", ecBits: 0, total: 242, data: 154, ecPerBlock: 22, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39, align: [6, 24, 42] }
    { version: 9, size: 53, ecLevel: "M", ecBits: 0, total: 292, data: 182, ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37, align: [6, 26, 46] }
    { version: 9, size: 53, ecLevel: "L", ecBits: 1, total: 292, data: 232, ecPerBlock: 30, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0, align: [6, 26, 46] }
  ]
end function

function qrXor(a as Integer, b as Integer) as Integer
  return (a or b) - (a and b)
end function

function qrShr(val as Integer, bits as Integer) as Integer
  if bits <= 0 then return val
  div = 1
  for i = 1 to bits
    div = div * 2
  end for
  return Int(val / div)
end function

function qrShl(val as Integer, bits as Integer) as Integer
  if bits <= 0 then return val
  mul = 1
  for i = 1 to bits
    mul = mul * 2
  end for
  return val * mul
end function

function qrGfTables() as Object
  gfExp = CreateObject("roArray", 512, false)
  gfLog = CreateObject("roArray", 256, false)
  for i = 0 to 511
    gfExp[i] = 0
  end for
  for i = 0 to 255
    gfLog[i] = 0
  end for
  x = 1
  for i = 0 to 254
    gfExp[i] = x
    gfLog[x] = i
    x = x * 2
    if (x and 256) <> 0 then x = qrXor(x, 285)
  end for
  for i = 255 to 511
    gfExp[i] = gfExp[i - 255]
  end for
  return { exp: gfExp, log: gfLog }
end function

function qrGfMul(a as Integer, b as Integer, gf as Object) as Integer
  if a = 0 or b = 0 then return 0
  return gf.exp[gf.log[a] + gf.log[b]]
end function

function qrRsGenerator(degree as Integer, gf as Object) as Object
  poly = [1]
  for i = 0 to degree - 1
    nxt = CreateObject("roArray", poly.Count() + 1, false)
    for k = 0 to poly.Count()
      nxt[k] = 0
    end for
    root = gf.exp[i]
    for j = 0 to poly.Count() - 1
      nxt[j] = qrXor(nxt[j], poly[j])
      nxt[j + 1] = qrXor(nxt[j + 1], qrGfMul(poly[j], root, gf))
    end for
    poly = nxt
  end for
  return poly
end function

function qrRsRemainder(data as Object, ecCount as Integer, gf as Object) as Object
  gen = qrRsGenerator(ecCount, gf)
  work = []
  for each b in data
    work.Push(b)
  end for
  for i = 0 to ecCount - 1
    work.Push(0)
  end for
  for i = 0 to data.Count() - 1
    factor = work[i]
    if factor <> 0
      for j = 0 to gen.Count() - 1
        work[i + j] = qrXor(work[i + j], qrGfMul(gen[j], factor, gf))
      end for
    end if
  end for
  out = []
  for i = data.Count() to work.Count() - 1
    out.Push(work[i])
  end for
  return out
end function

function qrSelectVersion(byteCount as Integer) as Dynamic
  for each spec in qrVersionSpecs()
    if byteCount <= spec.data - 2 then return spec
  end for
  return invalid
end function

sub qrPushBits(bits as Object, value as Integer, width as Integer)
  for i = width - 1 to 0 step -1
    bits.Push(qrShr(value, i) and 1)
  end for
end sub

function qrBuildCodewords(bytes as Object, spec as Object, gf as Object) as Object
  bits = []
  qrPushBits(bits, 4, 4)
  qrPushBits(bits, bytes.Count(), 8)
  for each b in bytes
    qrPushBits(bits, b and 255, 8)
  end for

  dataBits = spec.data * 8
  term = dataBits - bits.Count()
  if term > 4 then term = 4
  for i = 1 to term
    bits.Push(0)
  end for
  while (bits.Count() mod 8) <> 0
    bits.Push(0)
  end while

  codewords = []
  i = 0
  while i < bits.Count()
    val = 0
    for j = 0 to 7
      val = (val * 2) + bits[i + j]
    end for
    codewords.Push(val)
    i = i + 8
  end while

  padIdx = 0
  while codewords.Count() < spec.data
    if (padIdx mod 2) = 0 then codewords.Push(236) else codewords.Push(17)
    padIdx = padIdx + 1
  end while

  dataBlocks = []
  ecBlocks = []
  offset = 0
  for b = 0 to spec.g1Blocks - 1
    slice = []
    for k = 0 to spec.g1Data - 1
      slice.Push(codewords[offset + k])
    end for
    offset = offset + spec.g1Data
    dataBlocks.Push(slice)
    ecBlocks.Push(qrRsRemainder(slice, spec.ecPerBlock, gf))
  end for
  for b = 0 to spec.g2Blocks - 1
    slice = []
    for k = 0 to spec.g2Data - 1
      slice.Push(codewords[offset + k])
    end for
    offset = offset + spec.g2Data
    dataBlocks.Push(slice)
    ecBlocks.Push(qrRsRemainder(slice, spec.ecPerBlock, gf))
  end for

  out = []
  maxDataLen = spec.g1Data
  if spec.g2Data > maxDataLen then maxDataLen = spec.g2Data
  for k = 0 to maxDataLen - 1
    for each block in dataBlocks
      if k < block.Count() then out.Push(block[k])
    end for
  end for
  for k = 0 to spec.ecPerBlock - 1
    for each block in ecBlocks
      out.Push(block[k])
    end for
  end for
  return out
end function

function qrCreateMatrix(size as Integer) as Object
  modules = CreateObject("roArray", size, false)
  isFunc = CreateObject("roArray", size, false)
  for r = 0 to size - 1
    row = CreateObject("roArray", size, false)
    frow = CreateObject("roArray", size, false)
    for c = 0 to size - 1
      row[c] = 0
      frow[c] = false
    end for
    modules[r] = row
    isFunc[r] = frow
  end for
  return { size: size, modules: modules, isFunc: isFunc }
end function

sub qrSetFunc(grid as Object, r as Integer, c as Integer, dark as Boolean)
  if dark then grid.modules[r][c] = 1 else grid.modules[r][c] = 0
  grid.isFunc[r][c] = true
end sub

sub qrDrawFinder(grid as Object, top as Integer, leftPos as Integer)
  size = grid.size
  for dr = -1 to 7
    for dc = -1 to 7
      r = top + dr
      c = leftPos + dc
      if r >= 0 and r < size and c >= 0 and c < size
        onOuter = (dr = 0 or dr = 6 or dc = 0 or dc = 6)
        onInner = (dr >= 2 and dr <= 4 and dc >= 2 and dc <= 4)
        inFinder = (dr >= 0 and dr <= 6 and dc >= 0 and dc <= 6)
        qrSetFunc(grid, r, c, inFinder and (onOuter or onInner))
      end if
    end for
  end for
end sub

sub qrDrawAlignment(grid as Object, centerR as Integer, centerC as Integer)
  for dr = -2 to 2
    for dc = -2 to 2
      dark = (Abs(dr) = 2 or Abs(dc) = 2 or (dr = 0 and dc = 0))
      qrSetFunc(grid, centerR + dr, centerC + dc, dark)
    end for
  end for
end sub

function qrVersionBits(version as Integer) as Integer
  remBits = qrShl(version, 12)
  for i = 5 to 0 step -1
    if (qrShr(remBits, i + 12) and 1) <> 0
      remBits = qrXor(remBits, qrShl(7973, i)) ' 0x1F25
    end if
  end for
  return qrShl(version, 12) or remBits
end function

function qrFormatBits(ecBits as Integer, maskId as Integer) as Integer
  data = qrShl(ecBits, 3) or maskId
  remBits = qrShl(data, 10)
  for i = 4 to 0 step -1
    if (qrShr(remBits, i + 10) and 1) <> 0
      remBits = qrXor(remBits, qrShl(1335, i)) ' 0x537
    end if
  end for
  return qrXor(qrShl(data, 10) or remBits, 21522) ' 0x5412
end function

sub qrDrawFunctionPatterns(grid as Object, spec as Object)
  n = grid.size
  qrDrawFinder(grid, 0, 0)
  qrDrawFinder(grid, 0, n - 7)
  qrDrawFinder(grid, n - 7, 0)

  for i = 8 to n - 9
    dark = ((i mod 2) = 0)
    qrSetFunc(grid, 6, i, dark)
    qrSetFunc(grid, i, 6, dark)
  end for

  for each r in spec.align
    for each c in spec.align
      overlap = (r <= 8 and c <= 8) or (r <= 8 and c >= n - 8) or (r >= n - 8 and c <= 8)
      if not overlap then qrDrawAlignment(grid, r, c)
    end for
  end for

  for i = 0 to 8
    if i <> 6 then qrSetFunc(grid, 8, i, false)
    if i <> 6 then qrSetFunc(grid, i, 8, false)
  end for
  for i = n - 8 to n - 1
    qrSetFunc(grid, 8, i, false)
  end for
  for i = n - 7 to n - 1
    qrSetFunc(grid, i, 8, false)
  end for
  qrSetFunc(grid, (4 * spec.version) + 9, 8, true)

  if spec.version >= 7
    verBits = qrVersionBits(spec.version)
    for i = 0 to 17
      bit = ((qrShr(verBits, i) and 1) = 1)
      a = Int(i / 3)
      b = n - 11 + (i mod 3)
      qrSetFunc(grid, a, b, bit)
      qrSetFunc(grid, b, a, bit)
    end for
  end if
end sub

sub qrDrawFormatInfo(grid as Object, ecBits as Integer, maskId as Integer)
  n = grid.size
  bits = qrFormatBits(ecBits, maskId)
  topLeft = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8]
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ]
  for idx = 0 to 14
    dark = ((qrShr(bits, 14 - idx) and 1) = 1)
    coord = topLeft[idx]
    qrSetFunc(grid, coord[0], coord[1], dark)
    if idx < 7
      qrSetFunc(grid, n - 1 - idx, 8, dark)
    else
      qrSetFunc(grid, 8, n - 15 + idx, dark)
    end if
  end for
end sub

function qrMaskBit(maskId as Integer, r as Integer, c as Integer) as Boolean
  if maskId = 0 then return ((r + c) mod 2) = 0
  if maskId = 1 then return (r mod 2) = 0
  if maskId = 2 then return (c mod 3) = 0
  if maskId = 3 then return ((r + c) mod 3) = 0
  if maskId = 4 then return ((Int(r / 2) + Int(c / 3)) mod 2) = 0
  if maskId = 5 then return (((r * c) mod 2) + ((r * c) mod 3)) = 0
  if maskId = 6 then return ((((r * c) mod 2) + ((r * c) mod 3)) mod 2) = 0
  return ((((r + c) mod 2) + ((r * c) mod 3)) mod 2) = 0
end function

sub qrPlaceCodewords(grid as Object, codewords as Object, maskId as Integer)
  n = grid.size
  totalBits = codewords.Count() * 8
  bitIdx = 0
  upward = true
  right = n - 1
  while right >= 1
    if right = 6 then right = 5
    for stepIdx = 0 to n - 1
      r = stepIdx
      if upward then r = n - 1 - stepIdx
      for dx = 0 to 1
        c = right - dx
        if not grid.isFunc[r][c]
          bit = 0
          if bitIdx < totalBits
            byteVal = codewords[Int(bitIdx / 8)]
            bit = qrShr(byteVal, 7 - (bitIdx mod 8)) and 1
            bitIdx = bitIdx + 1
          end if
          if qrMaskBit(maskId, r, c) then bit = qrXor(bit, 1)
          grid.modules[r][c] = bit
        end if
      end for
    end for
    upward = not upward
    right = right - 2
  end while
end sub

function qrPenaltyScore(modules as Object) as Integer
  n = modules.Count()
  score = 0

  for r = 0 to n - 1
    runColor = modules[r][0]
    runLen = 1
    for c = 1 to n - 1
      if modules[r][c] = runColor
        runLen = runLen + 1
      else
        if runLen >= 5 then score = score + 3 + (runLen - 5)
        runColor = modules[r][c]
        runLen = 1
      end if
    end for
    if runLen >= 5 then score = score + 3 + (runLen - 5)
  end for

  for c = 0 to n - 1
    runColor = modules[0][c]
    runLen = 1
    for r = 1 to n - 1
      if modules[r][c] = runColor
        runLen = runLen + 1
      else
        if runLen >= 5 then score = score + 3 + (runLen - 5)
        runColor = modules[r][c]
        runLen = 1
      end if
    end for
    if runLen >= 5 then score = score + 3 + (runLen - 5)
  end for

  for r = 0 to n - 2
    for c = 0 to n - 2
      v = modules[r][c]
      if v = modules[r][c + 1] and v = modules[r + 1][c] and v = modules[r + 1][c + 1]
        score = score + 3
      end if
    end for
  end for

  p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
  for r = 0 to n - 1
    for c = 0 to n - 11
      m1 = true : m2 = true
      for k = 0 to 10
        if modules[r][c + k] <> p1[k] then m1 = false
        if modules[r][c + k] <> p2[k] then m2 = false
      end for
      if m1 or m2 then score = score + 40
    end for
  end for
  for c = 0 to n - 1
    for r = 0 to n - 11
      m1 = true : m2 = true
      for k = 0 to 10
        if modules[r + k][c] <> p1[k] then m1 = false
        if modules[r + k][c] <> p2[k] then m2 = false
      end for
      if m1 or m2 then score = score + 40
    end for
  end for

  dark = 0
  for r = 0 to n - 1
    for c = 0 to n - 1
      dark = dark + modules[r][c]
    end for
  end for
  pct = (dark * 100.0) / (n * n)
  diff = Abs(pct - 50.0)
  k = Int(diff / 5.0)
  score = score + (k * 10)
  return score
end function

function qrUtf8Bytes(text as String) as Object
  bytes = []
  n = Len(text)
  for i = 1 to n
    cp = Asc(Mid(text, i, 1))
    if cp < 0 then cp = cp + 256
    if cp < 128
      bytes.Push(cp)
    else if cp < 2048
      bytes.Push(192 + Int(cp / 64))
      bytes.Push(128 + (cp mod 64))
    else
      bytes.Push(224 + Int(cp / 4096))
      bytes.Push(128 + (Int(cp / 64) mod 64))
      bytes.Push(128 + (cp mod 64))
    end if
  end for
  return bytes
end function

function qrEncode(text as String) as Dynamic
  if text = invalid or text = "" then return invalid
  bytes = qrUtf8Bytes(text)
  spec = qrSelectVersion(bytes.Count())
  if spec = invalid then return invalid
  gf = qrGfTables()
  codewords = qrBuildCodewords(bytes, spec, gf)

  bestMask = 0
  bestPenalty = 2147483647
  bestModules = invalid
  for mask = 0 to 7
    grid = qrCreateMatrix(spec.size)
    qrDrawFunctionPatterns(grid, spec)
    qrPlaceCodewords(grid, codewords, mask)
    qrDrawFormatInfo(grid, spec.ecBits, mask)
    score = qrPenaltyScore(grid.modules)
    if score < bestPenalty
      bestPenalty = score
      bestMask = mask
      bestModules = grid.modules
    end if
  end for

  return {
    version: spec.version
    size: spec.size
    ecLevel: spec.ecLevel
    mask: bestMask
    modules: bestModules
  }
end function

function qrDarkRuns(modules as Object) as Object
  runs = []
  if modules = invalid then return runs
  n = modules.Count()
  for r = 0 to n - 1
    c = 0
    while c < n
      if modules[r][c] = 1
        start = c
        while c < n and modules[r][c] = 1
          c = c + 1
        end while
        runs.Push({ x: start, y: r, w: c - start })
      else
        c = c + 1
      end if
    end while
  end for
  return runs
end function
