const fs = require('fs');

module.exports = (() => {

    let fileName = './logs/' + new Date().getFullYear() + '.log';
    
    let log = (...args) => {
        let content = handleArgs(args);
        console.log(content);
        writeLog('[default] ' + new Date().toLocaleString('zh-Hans-tw') + ' ' + content);
    }
    let success = (...args) => {
        let content = handleArgs(args);
        console.log(content);
        writeLog('[success] ' + new Date().toLocaleString('zh-Hans-tw') + ' ' + content);
    }
    let error = (...args) => {
        let content = handleArgs(args);
        console.error(content);
        writeLog('[error] ' + new Date().toLocaleString('zh-Hans-tw') + ' ' + content);
    }

    let handleArgs = (args) => {
        return args.map(arg => {
            if(isJson(arg)) return JSON.stringify(arg);
            if(typeof(arg) === 'string') return arg.toString();
            if(typeof(arg) === 'number') return arg + '';
            if(typeof(arg) === 'boolean') return arg.toString();
            if(typeof(arg) === 'undefined') return 'undefined'; 

            return arg.toString();
        }).join(', ') + '\n';
    }
    let writeLog = (content) => {
        fs.appendFile(fileName, content, { encoding: 'utf8' }, function (err) {
            if (err) {
                console.error(err);
            }
        });
    }
    let isJson = (obj) => {
        try {
            JSON.parse(JSON.stringify(obj));
            return true;
        } catch(e) {
            return false;
        }
    }

    return {
        log: log,
        success: success,
        error: error,
    }
})();