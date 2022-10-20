"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuadComparator = exports.getTermComparator = exports.Quadstore = void 0;
__exportStar(require("./types"), exports);
var quadstore_1 = require("./quadstore");
Object.defineProperty(exports, "Quadstore", { enumerable: true, get: function () { return quadstore_1.Quadstore; } });
var comparators_1 = require("./utils/comparators");
Object.defineProperty(exports, "getTermComparator", { enumerable: true, get: function () { return comparators_1.getTermComparator; } });
Object.defineProperty(exports, "getQuadComparator", { enumerable: true, get: function () { return comparators_1.getQuadComparator; } });
//# sourceMappingURL=index.js.map