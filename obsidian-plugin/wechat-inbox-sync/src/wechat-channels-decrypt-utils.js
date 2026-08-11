const WECHAT_CHANNELS_ENCRYPTED_HEAD_BYTES = 131072;

function u64(value) {
  return BigInt.asUintN(64, value);
}

class Isaac64 {
  constructor(seed) {
    this.randrsl = new Array(256).fill(0n);
    this.mm = new Array(256).fill(0n);
    this.randcnt = 0;
    this.aa = 0n;
    this.bb = 0n;
    this.cc = 0n;
    this.randrsl[0] = u64(seed);
    this.randinit(true);
  }

  mix(a, b, c, d, e, f, g, h) {
    a = u64(a - e); f = u64(f ^ (h >> 9n)); h = u64(h + a);
    b = u64(b - f); g = u64(g ^ u64(a << 9n)); a = u64(a + b);
    c = u64(c - g); h = u64(h ^ (b >> 23n)); b = u64(b + c);
    d = u64(d - h); a = u64(a ^ u64(c << 15n)); c = u64(c + d);
    e = u64(e - a); b = u64(b ^ (d >> 14n)); d = u64(d + e);
    f = u64(f - b); c = u64(c ^ u64(e << 20n)); e = u64(e + f);
    g = u64(g - c); d = u64(d ^ (f >> 17n)); f = u64(f + g);
    h = u64(h - d); e = u64(e ^ u64(g << 14n)); g = u64(g + h);
    return [a, b, c, d, e, f, g, h];
  }

  randinit(flag) {
    let a = 0x9e3779b97f4a7c13n;
    let b = a;
    let c = a;
    let d = a;
    let e = a;
    let f = a;
    let g = a;
    let h = a;

    for (let index = 0; index < 4; index += 1) {
      [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
    }

    for (let index = 0; index < 256; index += 8) {
      if (flag) {
        a = u64(a + this.randrsl[index]);
        b = u64(b + this.randrsl[index + 1]);
        c = u64(c + this.randrsl[index + 2]);
        d = u64(d + this.randrsl[index + 3]);
        e = u64(e + this.randrsl[index + 4]);
        f = u64(f + this.randrsl[index + 5]);
        g = u64(g + this.randrsl[index + 6]);
        h = u64(h + this.randrsl[index + 7]);
      }
      [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
      this.mm[index] = a;
      this.mm[index + 1] = b;
      this.mm[index + 2] = c;
      this.mm[index + 3] = d;
      this.mm[index + 4] = e;
      this.mm[index + 5] = f;
      this.mm[index + 6] = g;
      this.mm[index + 7] = h;
    }

    if (flag) {
      for (let index = 0; index < 256; index += 8) {
        a = u64(a + this.mm[index]);
        b = u64(b + this.mm[index + 1]);
        c = u64(c + this.mm[index + 2]);
        d = u64(d + this.mm[index + 3]);
        e = u64(e + this.mm[index + 4]);
        f = u64(f + this.mm[index + 5]);
        g = u64(g + this.mm[index + 6]);
        h = u64(h + this.mm[index + 7]);
        [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
        this.mm[index] = a;
        this.mm[index + 1] = b;
        this.mm[index + 2] = c;
        this.mm[index + 3] = d;
        this.mm[index + 4] = e;
        this.mm[index + 5] = f;
        this.mm[index + 6] = g;
        this.mm[index + 7] = h;
      }
    }

    this.isaac64();
    this.randcnt = 256;
  }

  isaac64() {
    this.cc = u64(this.cc + 1n);
    this.bb = u64(this.bb + this.cc);

    for (let index = 0; index < 256; index += 1) {
      const x = this.mm[index];
      switch (index % 4) {
        case 0:
          this.aa = u64(~u64(this.aa ^ u64(this.aa << 21n)));
          break;
        case 1:
          this.aa = u64(this.aa ^ (this.aa >> 5n));
          break;
        case 2:
          this.aa = u64(this.aa ^ u64(this.aa << 12n));
          break;
        default:
          this.aa = u64(this.aa ^ (this.aa >> 33n));
          break;
      }
      this.aa = u64(this.aa + this.mm[(index + 128) % 256]);
      const y = u64(this.mm[Number((x >> 3n) & 255n)] + this.aa + this.bb);
      this.mm[index] = y;
      this.bb = u64(this.mm[Number((y >> 11n) & 255n)] + x);
      this.randrsl[index] = this.bb;
    }
  }

  next() {
    if (this.randcnt === 0) {
      this.isaac64();
      this.randcnt = 256;
    }
    this.randcnt -= 1;
    return this.randrsl[this.randcnt];
  }

  generate(length) {
    const result = Buffer.alloc(Math.max(0, Number(length) || 0));
    let position = 0;
    while (position < result.length) {
      const value = this.next();
      for (let shift = 56; shift >= 0 && position < result.length; shift -= 8) {
        result[position] = Number((value >> BigInt(shift)) & 0xffn);
        position += 1;
      }
    }
    return result;
  }
}

function parseWechatChannelsDecryptKey(decryptKey) {
  const value = String(decryptKey || '').trim();
  if (!value) return null;
  try {
    if (/^0x[0-9a-f]+$/i.test(value) || /^\d+$/.test(value)) {
      return u64(BigInt(value));
    }
  } catch (error) {
    return null;
  }
  return null;
}

function generateWechatChannelsDecryptorBytes(decryptKey, length) {
  const seed = parseWechatChannelsDecryptKey(decryptKey);
  if (seed === null) return Buffer.alloc(0);
  return new Isaac64(seed).generate(length);
}

function decryptWechatChannelsMediaBuffer(buffer, decryptKey, limit = WECHAT_CHANNELS_ENCRYPTED_HEAD_BYTES) {
  const input = Buffer.from(buffer || []);
  const seed = parseWechatChannelsDecryptKey(decryptKey);
  if (seed === null || !input.length) return input;
  const result = Buffer.from(input);
  const decryptLength = Math.min(result.length, Math.max(0, Number(limit) || 0));
  const keyBytes = new Isaac64(seed).generate(decryptLength);
  for (let index = 0; index < decryptLength; index += 1) {
    result[index] ^= keyBytes[index];
  }
  return result;
}

module.exports = {
  generateWechatChannelsDecryptorBytes,
  decryptWechatChannelsMediaBuffer,
};
