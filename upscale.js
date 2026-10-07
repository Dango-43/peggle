// Pixel-art upscaler: draws a small source canvas onto a larger WebGL2 canvas
// using xBR level 2 (after Hyllian's xBR-lv2 shader, as used in libretro),
// which smooths diagonal edges and curves while keeping the image crisp.

const VERTEX = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
    uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5); // (0,0) = top-left
    gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D src;
uniform vec2 srcSize;
uniform float delta; // source texels per output pixel
in vec2 uv;
out vec4 outColor;

const vec4 Ao = vec4( 1.0, -1.0, -1.0,  1.0);
const vec4 Bo = vec4( 1.0,  1.0, -1.0, -1.0);
const vec4 Co = vec4( 1.5,  0.5, -0.5,  0.5);
const vec4 Ax = vec4( 1.0, -1.0, -1.0,  1.0);
const vec4 Bx = vec4( 0.5,  2.0, -0.5, -2.0);
const vec4 Cx = vec4( 1.0,  1.0, -0.5,  0.0);
const vec4 Ay = vec4( 1.0, -1.0, -1.0,  1.0);
const vec4 By = vec4( 2.0,  0.5, -2.0, -0.5);
const vec4 Cy = vec4( 2.0,  0.0, -1.0,  0.5);
const vec4 Ci = vec4(0.25);
const vec3 Y = 48.0 * vec3(0.2126, 0.7152, 0.0722);

ivec2 base;
ivec2 maxPos;

vec3 T(int x, int y) {
    return texelFetch(src, clamp(base + ivec2(x, y), ivec2(0), maxPos), 0).rgb;
}
vec4 df(vec4 a, vec4 b) { return abs(a - b); }
float c_df(vec3 a, vec3 b) { vec3 d = abs(a - b); return d.r + d.g + d.b; }
vec4 neq(vec4 a, vec4 b) { return step(0.01, abs(a - b)); }
vec4 le(vec4 a, vec4 b) { return step(a, b); }
vec4 lt(vec4 a, vec4 b) { return 1.0 - step(b, a); }
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
    return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}

void main() {
    vec2 p = uv * srcSize;
    base = ivec2(floor(p));
    maxPos = ivec2(srcSize) - 1;
    vec2 fp = fract(p);

    //          A1 B1 C1
    //       A0  A  B  C C4
    //       D0  D  E  F F4
    //       G0  G  H  I I4
    //          G5 H5 I5
    vec3 A1 = T(-1,-2), B1 = T(0,-2), C1 = T(1,-2);
    vec3 A0 = T(-2,-1), A = T(-1,-1), B = T(0,-1), C = T(1,-1), C4 = T(2,-1);
    vec3 D0 = T(-2, 0), D = T(-1, 0), E = T(0, 0), F = T(1, 0), F4 = T(2, 0);
    vec3 G0 = T(-2, 1), G = T(-1, 1), H = T(0, 1), I = T(1, 1), I4 = T(2, 1);
    vec3 G5 = T(-1, 2), H5 = T(0, 2), I5 = T(1, 2);

    vec4 b = Y * mat4x3(B, D, H, F);
    vec4 c = Y * mat4x3(C, A, G, I);
    vec4 e = Y * mat4x3(E, E, E, E);
    vec4 d = b.yzwx;
    vec4 f = b.wxyz;
    vec4 g = c.zwxy;
    vec4 h = b.zwxy;
    vec4 i = c.wxyz;
    vec4 i4 = Y * mat4x3(I4, C1, A0, G5);
    vec4 i5 = Y * mat4x3(I5, C4, A1, G0);
    vec4 h5 = Y * mat4x3(H5, F4, B1, D0);
    vec4 f4 = h5.yzwx;

    vec4 fx      = Ao * fp.y + Bo * fp.x;
    vec4 fx_left = Ax * fp.y + Bx * fp.x;
    vec4 fx_up   = Ay * fp.y + By * fp.x;

    vec4 ir0     = neq(e, f) * neq(e, h);
    vec4 irLeft  = neq(e, g) * neq(d, g);
    vec4 irUp    = neq(e, c) * neq(b, c);

    vec4 dl  = vec4(delta);
    vec4 dlL = vec4(0.5 * delta, delta, 0.5 * delta, delta);
    vec4 dlU = dlL.yxwz;

    vec4 fx45i = clamp((fx      + dl  - Co - Ci) / (2.0 * dl ), 0.0, 1.0);
    vec4 fx45  = clamp((fx      + dl  - Co     ) / (2.0 * dl ), 0.0, 1.0);
    vec4 fx30  = clamp((fx_left + dlL - Cx     ) / (2.0 * dlL), 0.0, 1.0);
    vec4 fx60  = clamp((fx_up   + dlU - Cy     ) / (2.0 * dlU), 0.0, 1.0);

    vec4 w1 = wd(e, c, g, i, h5, f4, h, f);
    vec4 w2 = wd(h, d, i5, f, i4, b, e, i);

    vec4 edri    = le(w1, w2) * ir0;
    vec4 edr     = lt(w1, w2) * ir0;
    vec4 edrLeft = le(2.0 * df(f, g), df(h, c)) * irLeft * edr;
    vec4 edrUp   = le(2.0 * df(h, c), df(f, g)) * irUp * edr;

    fx45  *= edr;
    fx30  *= edrLeft;
    fx60  *= edrUp;
    fx45i *= edri;

    vec4 px = le(df(e, f), df(e, h));
    vec4 m = max(max(fx30, fx60), max(fx45, fx45i));

    vec3 r1 = E;
    r1 = mix(r1, mix(H, F, px.x), m.x);
    r1 = mix(r1, mix(B, D, px.z), m.z);
    vec3 r2 = E;
    r2 = mix(r2, mix(F, B, px.y), m.y);
    r2 = mix(r2, mix(D, H, px.w), m.w);

    outColor = vec4(mix(r1, r2, step(c_df(E, r1), c_df(E, r2))), 1.0);
}`;

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

// Returns null if WebGL2 is not available.
export function createUpscaler(canvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) return null;

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const srcSizeLoc = gl.getUniformLocation(program, "srcSize");
    const deltaLoc = gl.getUniformLocation(program, "delta");

    return {
        draw(source) {
            if (!source.width || !canvas.width) return;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            gl.uniform2f(srcSizeLoc, source.width, source.height);
            gl.uniform1f(deltaLoc, Math.min(1, source.width / canvas.width));
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        },
    };
}
