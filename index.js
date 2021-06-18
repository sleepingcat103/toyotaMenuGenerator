
const axios = require('axios');
const https = require('https');

let { chatLogUrl, assistantConfigs, cloudant, defaultButtons } = require('./configs');
let targetNodeLogs, newButtons;
let startTime = new Date(new Date().toDateString()).getTime() - 7*24*60*60*1000
let endTime = new Date(new Date().toDateString()).getTime();

let logger = require('./easyLogger');

logger.log('===================================');
logger.log('自動化生成服務目錄 - 程序開始');
logger.log('此次篩選對話記錄期間', `${new Date(startTime).toLocaleDateString()} ~ ${new Date(endTime).toLocaleDateString()}` );

logger.log('開始撈取對話記錄');
getChatLogs().then(logs => {
    logger.log('成功撈取對話記錄，篩選對話記錄資料數:', logs.length);
    targetNodeLogs = logs.map(doc => {
        try{
            let { assistantOut, path } = doc
            return {
                path,
                nodeId: assistantOut.output.nodes_visited.reverse().find(id => !id.startsWith('response'))
            }
        } catch(e) {
            logger.log('無法處理的紀錄', doc);
        }
    }).filter(node => node);

    logger.log('開始撈取 Watson Assistant 節點資訊');
    return Promise.all(
        assistantConfigs.map(config => { 
            return getDialogNodes(config);
        })
    );
}).then(responses => {
    logger.log('成功撈取 Watson Assistant 節點資訊');
    // 整理出 title
    let titles = targetNodeLogs.map(log => {
        return responses.find(response => {
            return log.path.endsWith(response.pattern);
        }).dialog_nodes.find(node => {
            return node.dialog_node == log.nodeId;
        })
    })
    .filter(node => node && node.hasOwnProperty('title') && node.title.indexOf('-') > -1)
    .map(node => node.title);

    // 區分類別
    let service = {}, sale = {};

    // 根據title區分類別
    titles.forEach(title => {
        let words = title.split('-');
        let target;
        if(words[0] == '服務') {
            target = service;
        } else if(words[0] == '販賣') {
            target = sale;
        } else {
            return;
        }
        
        if(words[1]) {
            if(target.hasOwnProperty(words[1])) {
                target[words[1]] ++;
            } else {
                target[words[1]] = 1;
            }
        }
    })

    service = Object.keys(service).map(key => { return { type: 'service', text: key, count: service[key] } });
    sale = Object.keys(sale).map(key => { return { type: 'sale', text: key, count: sale[key] } });

    newButtons = {
        service: service.sort((a,b) => b.count - a.count ).splice(0, 4),
        sale: sale.sort((a,b) => b.count - a.count ).splice(0, 4),
        other: service.concat(sale).sort((a,b) => b.count - a.count ).splice(0, 4)
    }
    
    logger.log('初步整理結果如下 : ');
    logger.log('服務', newButtons.service);
    logger.log('販賣', newButtons.sale);
    logger.log('其他', newButtons.other);

    // 數量類別不需要了，只留下文字
    Object.keys(newButtons).forEach(key => { newButtons[key] = newButtons[key].map(item => item.text) });

    // 不足4個補到4個
    if(newButtons.service.length < 4) {
        newButtons.service.concat(defaultButtons.slice(0, 4 - newButtons.service.length));
    }
    if(newButtons.sale.length < 4) {
        newButtons.sale.concat(defaultButtons.slice(0, 4 - newButtons.sale.length));
    }
    if(newButtons.other.length < 4) {
        newButtons.other.concat(defaultButtons.slice(0, 4 - newButtons.other.length));
    }

    logger.log('各類不滿四個項目回填預設值，結果如下 : ', newButtons);
    logger.log('開始撈取答案包文件');

    return axios({
        url: `https://${cloudant.username}:${cloudant.password}@${cloudant.username}.cloudant.com/${cloudant.dbName}/_find`,
        method: 'post',
        data: {
            "selector": {
                "ansId": 'SYS-MENU'
            },
            "fields": [
                "_id",
                "_rev",
                "ansId",
                "messages"
            ]
        }
    })
}).then(response => {
    logger.log('成功撈取答案包文件');
    let { docs: [doc] } = response.data;
    console.log(doc)
    let headers = {
        'If-Match': doc._rev
    }
    let id = doc._id;

    delete doc._id;
    delete doc._rev;

    let { messages: [ menu ] } = doc;

    // sale
    menu.template.columns[1].actions
        = newButtons.sale.map(text => { return { 'label': text, 'type': 'message', 'text': text } });
    // service
    menu.template.columns[2].actions
        = newButtons.service.map(text => { return { 'label': text, 'type': 'message', 'text': text } });
    // other
    menu.template.columns[3].actions
        = newButtons.other.map(text => { return { 'label': text, 'type': 'message', 'text': text } });

    logger.log('生成新答案包文件', doc);
    logger.log('開始寫回答案包文件');
    
    return axios({
        url: `https://${cloudant.username}:${cloudant.password}@${cloudant.username}.cloudant.com/${cloudant.dbName}/${ id }`,
        method: 'PUT',
        headers,
        data: doc
    })
}).then(response => {
    logger.log('寫回答案包文件成功');
    logger.success('自動化生成服務目錄 - 全部作業成功');
}).catch(error => {
    logger.error('自動化生成服務目錄 - 作業失敗')
    logger.error(error.toString());
})

function getChatLogs(body) {
    // return Promise.reject();
    let limit = 500;
    body = body || {
        "apikey": "8b90a23e-f726-45bc-8c46-f58fc50b7ffc",
        "dbName": "nodered_servicebot_prod02_faq_dispatch",
        "query": {
            "selector": {
                "from": "toyota-ow",
                "route": "chat",
                "apiCall": {
                    "$gt": startTime,
                    "$lt": endTime,
                }
            },
            "fields": [ "route", "assistantOut", "path" ],
            "limit": limit
        }
    }
    
    return axios({
        url: chatLogUrl,
        method: 'post',
        data: body,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
    })
    .then(async response => {
        let { data } = response.data;

        if(data.docs.length < limit) {
            return data.docs;
        } else {
            body.query.bookmark = data.bookmark;
            return data.docs.concat(await getChatLogs(body));
        }
    })
}

function getDialogNodes(config) {  
    return axios({
        url: `${config.url}/v1/workspaces/${config.workspaceId}/dialog_nodes?version=2020-04-01&page_limit=1000`,
        method: 'GET',
        headers: {
            "Authorization": `Basic ${Buffer.from(`apikey:${config.apikey}`, 'binary').toString('base64')}`,
            "Content-Type": "application/json"
        }
    })
    .then(response => {
        return Promise.resolve(Object.assign(config, response.data));
    })
    .catch(error => {
        return Promise.reject(error);
    })
}


