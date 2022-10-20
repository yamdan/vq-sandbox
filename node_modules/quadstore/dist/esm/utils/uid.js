let IDX = 256;
const HEX = [];
while (IDX--) {
    HEX[IDX] = (IDX + 256).toString(16).substring(1);
}
export const createUid = (len) => {
    len = len || 16;
    let str = '';
    let num = 0;
    return () => {
        if (!str || num === 256) {
            str = '';
            num = (1 + len) / 2 | 0;
            while (num--) {
                str += HEX[256 * Math.random() | 0];
            }
            str = str.substring(num = 0, len - 2);
        }
        return str + HEX[num++];
    };
};
export const uid = createUid(11);
//# sourceMappingURL=uid.js.map