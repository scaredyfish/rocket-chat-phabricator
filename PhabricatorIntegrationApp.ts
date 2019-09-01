import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
    IMessageBuilder
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IMessage,IPreMessageSentModify, IMessageAttachment, IPostMessageSent } from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class PhabricatorIntegrationApp extends App implements IPreMessageSentModify, IPostMessageSent{
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    //Suport Phabricator Task, Differential ,File,Paste  e.g : T1234, D1234, F1234
    private phabricator_matcher : RegExp = /[TDFP]\d{2,}\b/gm 
    //Suport Phabricator commit hash for at least 12  characters longs 
    private commit_matcher  : RegExp = /\b(rB)?([a-f0-9]{11,40})\b/gm;

    private isTextMatching(text:string,matcher :RegExp){
        return matcher.test(text)
    }

    public async checkPreMessageSentModify(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        if (typeof message.text !== 'string') {
            return false;
        }
        let result:boolean = false

        result = result || this.isTextMatching(message.text, this.phabricator_matcher)
        result = result|| this.isTextMatching(message.text, this.commit_matcher)

        return result;
    }
    public async executePreMessageSentModify(message: IMessage, builder: IMessageBuilder, read: IRead, http: IHttp, persistence: IPersistence): Promise<IMessage> {
        const server = await read.getEnvironmentReader().getSettings().getValueById('phabricator_server');

        let text = message.text || '';
        
        //replace text with corresponding markdown
        text = text.replace(this.phabricator_matcher, `[$&](${server}/$&)`);
        text = text.replace(this.commit_matcher, `[$&](${server}/rB$2)`);

        /*  How to remove default attachements? 
        let attachements :Array<IMessageAttachment> = [];
        builder.setAttachments(attachements) 
        */
        return builder.setText(text).getMessage();
    }

    public async checkPostMessageSent(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        return true;
    }

    public async executePostMessageSent(message: IMessage, read: IRead, http: IHttp, persistence: IPersistence, modify: IModify): Promise<void> {
        if (!message.id) {
            return;
        }

        const api_token = await read.getEnvironmentReader().getSettings().getValueById('phabricator_apikey');
        const server = await read.getEnvironmentReader().getSettings().getValueById('phabricator_server');

        let text = message.text || '';

        let attachments : Array<IMessageAttachment> = [];
        const regex = /\bT([0-9]+)\b/g;
        let match = regex.exec(text);
        let memoization_task = {}
        while (match != null) {
            let link = await http.get(`${server}/api/maniphest.info`,
            {
                params: {
                    'api.token': api_token,
                    'task_id': match[1],
                },
            });
            let attachment = {
                title: {
                    value: `${link.data.result.objectName} ${link.data.result.title}`,
                    link: link.data.result.uri,
                },
                text: link.data.result.description,
                collapsed: true,
            };
            if (!(link.data.result.objectName in memoization_task))
            {
                console.log(attachments);
                attachments.push(attachment);
                memoization_task[link.data.result.objectName] = attachment
            }

            match = regex.exec(text);
        }

        let extender = await modify.getExtender();
        let modifier = await extender.extendMessage(message.id, message.sender);
        modifier.addAttachments(attachments);
        extender.finish(modifier);
    }

    protected async extendConfiguration(configuration: IConfigurationExtend, environmentRead: IEnvironmentRead): Promise<void> {
        await configuration.settings.provideSetting({
            id: 'phabricator_server',
            type: SettingType.STRING,
            packageValue: 'https://developer.blender.org',
            required: true,
            public: false,
            i18nLabel: 'phabricator_serverurl',
            i18nDescription: 'phabricator_serverurl_description',
        });

        await configuration.settings.provideSetting({
            id: 'phabricator_apikey',
            type: SettingType.STRING,
            packageValue: 'api-ssb3tye4uhqpq6336z564qb25h3d',
            required: true,
            public: false,
            i18nLabel: 'phabricator_apikey',
            i18nDescription: 'phabricator_apikey_description',
        });
    }
}
