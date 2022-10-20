"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encode = void 0;
const join = (encodingCase, exponent, mantissa) => {
    let r = '' + encodingCase;
    if (exponent < 10) {
        r += '00' + exponent;
    }
    else if (exponent < 100) {
        r += '0' + exponent;
    }
    else {
        r += exponent;
    }
    r += mantissa.toFixed(17);
    return r;
};
const ZERO = join(3, 0, 0);
const NEG_INF = join(0, 0, 0);
const POS_INF = join(6, 0, 0);
const encode = (stringOrNumber) => {
    let mantissa = typeof stringOrNumber !== 'number'
        ? parseFloat(stringOrNumber)
        : stringOrNumber;
    if (Number.isNaN(mantissa)) {
        throw new Error(`Cannot serialize NaN`);
    }
    if (mantissa === -Infinity) {
        return NEG_INF;
    }
    if (mantissa === Infinity) {
        return POS_INF;
    }
    if (mantissa === 0) {
        return ZERO;
    }
    let exponent = 0;
    let sign = 0;
    if (mantissa < 0) {
        sign = 1;
        mantissa *= -1;
    }
    while (mantissa > 10) {
        mantissa /= 10;
        exponent += 1;
    }
    while (mantissa < 1) {
        mantissa *= 10;
        exponent -= 1;
    }
    if (sign === 1) {
        if (exponent >= 0) {
            return join(1, 999 - exponent, 10 - mantissa);
        }
        else {
            return join(2, exponent * -1, 10 - mantissa);
        }
    }
    else {
        if (exponent < 0) {
            return join(4, 999 + exponent, mantissa);
        }
        else {
            return join(5, exponent, mantissa);
        }
    }
};
exports.encode = encode;
//# sourceMappingURL=fpstring.js.map