import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IMessage, IMessageAttachment, IPostMessageSent } from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class PhabricatorIntegrationApp extends App implements IPostMessageSent {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
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

        while (match != null) {
            let link = await http.get(`${server}/api/maniphest.info`,
            {
                params: {
                    'api.token': api_token,
                    'task_id': match[1],
                },
            });

            attachments.push({
                title: {
                    value: link.data.result.title,
                    link: link.data.result.uri,
                },
                text: link.data.result.description,
                collapsed: true,
            });

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
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'phabricator_serverurl',
            i18nDescription: 'phabricator_serverurl_description',
        });

        await configuration.settings.provideSetting({
            id: 'phabricator_apikey',
            type: SettingType.STRING,
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'phabricator_apikey',
            i18nDescription: 'phabricator_apikey_description',
        });
    }
}
