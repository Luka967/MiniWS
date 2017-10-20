module.exports = {
    parseExtensions: function(string) {
        if (string == null) return { };
        var str2 = string.split(",");
        var parsed = {};
        var invalid = false;
        for (var i = 0; i < str2.length; i++) {
            var ext = str2[i].trim();
            if (ext.length === 0) {
                // invalid length
                invalid = true;
                break;
            }
            var args = ext.split(";");
            parsed[args[0]] = {};
            for (var j = 1; j < args.length; j++) {
                if (args[j].length === 0) {
                    // invalid extension
                    invalid = true;
                    break;
                }
                var val = args[j].trim().split("=");
                if (val[0].length === 0 || val.length > 1 && val[1].length === 0) {
                    // invalid argument
                    invalid = true;
                    break;
                }
                if (val.length > 1) {
                    var a = val[1][0], b = val[1][val[1].length - 1];
                    if (a === '"' && b === '"')
                        val[1] = val[1].slice(1, val[1].length - 1);
                    else if (a !== '"' && b !== '"') {
                        if (/\s/.test(val[1])) {
                            // non-quoted argument value contains space
                            invalid = true;
                            break;
                        }
                    } else {
                        // non-opened/non-closed quotes
                        invalid = true;
                        break;
                    }
                } else val[1] = true;
                parsed[args[0]][val[0]] = val[1];
            }
        }
        return invalid ? false : parsed;
    },
    stringifyExtensions: function(obj) {
        var ret = "";
        for (var i in obj) {
            ret += i.toLowerCase();
            if (Object.keys(obj[i]).length) {
                ret += "; ";
                for (var j in obj[i])
                    ret += `${j.toLowerCase()}=${JSON.stringify(obj[i][j])}; `;
                ret = ret.slice(0, ret.length - 2);
            }
            ret += ", ";
        }
        ret = ret.slice(0, ret.length - 2);
        return ret;
    },
    parseProtocols: function(string) {
        if (string == null) return [];
        var spl = string.split(/[\s]*,[\s]*/);
        var invalid = false;
        for (var i = 0; i < spl.length; i++)
            if (!spl[i].length || /[\s]/.test(spl[i]))
                invalid = true;
        return invalid ? false : spl;
    },
    stringifyProtocols: function(list) {
        return list.map((a) => a.toLowerCase()).join(", ");
    }
};