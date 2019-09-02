import {
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
    IMessageBuilder,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IMessage, IMessageAttachment, IPostMessageSent, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class PhabricatorIntegrationApp extends App implements IPostMessageSent, IPreMessageSentModify {
    // Convert files and pastes to links
    private link_matcher: RegExp = /[FP]\d{2,}\b/gm;

    private embed_matcher: RegExp = /\b(T|D)([0-9]+)\b/gm;
    // Suport Phabricator commit hash for at least 12  characters longs
    // TODO: Currently Blender-specific
    private commit_matcher: RegExp = /\b(rB)?([a-f0-9]{11,40})\b/gm;

    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async checkPreMessageSentModify(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        if (typeof message.text !== 'string') {
            return false;
        }
        let result: boolean = false;

        result = result || this.isTextMatching(message.text, this.link_matcher);
        result = result || this.isTextMatching(message.text, this.commit_matcher);

        return result;
    }

    public async executePreMessageSentModify(
        message: IMessage,
        builder: IMessageBuilder,
        read: IRead,
        http: IHttp,
        persistence: IPersistence): Promise<IMessage> {

        const server = await read.getEnvironmentReader().getSettings().getValueById('phabricator_server');

        let text = message.text || '';

        // replace text with corresponding markdown
        text = text.replace(this.link_matcher, `[$&](${server}/$&)`);
        text = text.replace(this.commit_matcher, `[$&](${server}/rB$2)`);

        return builder.setText(text).getMessage();
    }

    public async checkPostMessageSent(message: IMessage, read: IRead, http: IHttp): Promise<boolean> {
        return this.embed_matcher.test(message.text || '');
    }

    public async executePostMessageSent(message: IMessage, read: IRead, http: IHttp, persistence: IPersistence, modify: IModify): Promise<void> {
        if (!message.id) {
            return;
        }

        const api_token = await read.getEnvironmentReader().getSettings().getValueById('phabricator_apikey');
        const server = await read.getEnvironmentReader().getSettings().getValueById('phabricator_server');

        let text = message.text || '';

        let attachments: Array<IMessageAttachment> = [];

        this.embed_matcher.lastIndex = 0;
        let match = this.embed_matcher.exec(text);

        while (match != null) {
            let attachment: IMessageAttachment;

            switch (match[1]) {
                case 'T': attachment = await this.getManiphestAttachment(match[2], http, api_token, server);
                          break;
                case 'D': attachment = await this.getDifferentialAttachment(match[2], http, api_token, server);
                          break;
                default: continue;
            }

            attachments.push(attachment);

            match = this.embed_matcher.exec(text);
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

    private isTextMatching(text: string, matcher: RegExp) {
        return matcher.test(text);
    }

    private async getManiphestAttachment(task_id: string, http: IHttp, api_token: string, server: string): Promise<IMessageAttachment> {
        let link = await http.get(`${server}/api/maniphest.info`,
            {
                params: {
                    'api.token': api_token,
                    'task_id': task_id,
                },
            });

        return {
            title: {
                value: `${link.data.result.objectName} ${link.data.result.title}`,
                link: link.data.result.uri,
            },
            text: link.data.result.description,
            collapsed: true,
        };
    }

    private async getDifferentialAttachment(diff_id: string, http: IHttp, api_token: string, server: string): Promise<IMessageAttachment> {
        let params = JSON.stringify({
            __conduit__: { token: api_token },
            constraints: { ids: [Number(diff_id)] },
        });

        let content = 'params=' + params;

        let link = await http.post(`${server}/api/differential.revision.search`, {content});

        let result = link.data.result.data[0];

        return {
            description: result.fields.summary,
            title: {
                value: result.fields.title,
                link: `${server}/D${result.fields.id}`,
            },
            collapsed: true,
        };
    }
}
