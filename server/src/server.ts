"use strict";

import {
    CodeActionParams, CodeLens, CodeLensParams,
    createConnection, IConnection, InitializeResult, IPCMessageReader,
    IPCMessageWriter, RenameParams, ResponseError,
    TextDocument, TextDocumentItem, TextDocumentPositionParams, TextDocuments,
} from "vscode-languageserver";
import Uri from "vscode-uri";
import { DafnyInstaller } from "./backend/dafnyInstaller";
import { IDafnySettings } from "./backend/dafnySettings";
import { DependencyVerifier } from "./backend/dependencyVerifier";
import { ReferencesCodeLens } from "./backend/features/codeLenses";
import { ICompilerResult } from "./backend/ICompilerResult";
import ServerNotReadyResponseError from "./errors/ServerNotReadyResponseError";
import { DafnyServerProvider } from "./frontend/dafnyProvider";
import { NotificationService } from "./notificationService";
import { InfoMsg } from "./strings/stringRessources";
import { LanguageServerNotification, LanguageServerRequest } from "./strings/stringRessources";

const MAX_CONNECTION_RETRIES = 30;

const connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
const documents: TextDocuments = new TextDocuments();
const codeLenses: { [codeLens: string]: ReferencesCodeLens; } = {};
let settings: ISettings;
let started: boolean = false;
let notificationService: NotificationService;
let dafnyInstaller: DafnyInstaller;

documents.listen(connection);

let workspaceRoot: string;
let provider: DafnyServerProvider;

connection.onInitialize((params): InitializeResult => {
    workspaceRoot = params.rootPath!; // TODO: This line is probably the main reason why only workspaces can be opened.
    notificationService = new NotificationService(connection);
    return {
        capabilities: {
            codeActionProvider: true,
            codeLensProvider: { resolveProvider: true },
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ["."],
            },
            definitionProvider: true,
            hoverProvider: true,
            renameProvider: true,
            textDocumentSync: documents.syncKind,
        },
    };
});

function verifyDependencies() {
    const dependencyVerifier: DependencyVerifier = new DependencyVerifier();
    dafnyInstaller = new DafnyInstaller(notificationService);
    dependencyVerifier.verifyDafnyServer(workspaceRoot, notificationService, settings.dafny, (serverVersion: string) => {
        init(serverVersion);
        dafnyInstaller.latestVersionInstalled(serverVersion).then((latest) => {
            if (!latest) {
                connection.sendNotification(LanguageServerNotification.DafnyMissing, InfoMsg.DafnyUpdateAvailable);
            }
        }).catch(() => {
            console.error("can't access github");
        });
    }, () => {
        connection.sendNotification(LanguageServerNotification.DafnyMissing, InfoMsg.AskInstallDafny);
    });
}

function init(serverVersion: string) {
    try {
        if (!provider) {
            provider = new DafnyServerProvider(notificationService, serverVersion, workspaceRoot, settings.dafny);
            provider.resetServer();
            verifyAll();
        } else {
            provider.init();
            provider.resetServer();
            verifyAll();
        }
    } catch (e) {
        connection.sendNotification(LanguageServerNotification.Error, "Exception occured: " + e);
    }
}

function verifyAll() {
    console.log("verify all" + documents.all().length);
    if (provider) {
        documents.all().forEach((d) => {
            console.log("all verify" + d.uri);
            provider.doVerify(d);
        });
    }
}

connection.onRenameRequest((handler: RenameParams) => {
    if (provider && provider.renameProvider) {
        return provider.renameProvider.provideRenameEdits(documents.get(handler.textDocument.uri), handler.position, handler.newName);
    }
    return new ServerNotReadyResponseError();
});

connection.onDefinition((handler: TextDocumentPositionParams) => {
    if (provider && provider.definitionProvider) {
        return provider.definitionProvider.provideDefinition(documents.get(handler.textDocument.uri), handler.position);
    }
    return new ServerNotReadyResponseError();
});

function waitForServer(handler: CodeLensParams) {
    return new Promise(async (resolve, reject) => {
        let tries = 0;
        while (!(provider && provider.referenceProvider) && tries < MAX_CONNECTION_RETRIES) {
            await sleep(2000);
            tries++;
        }
        if ((provider && provider.referenceProvider)) {
            resolve();
        } else {
            reject();
        }
    }).then(() => {
        const result = provider.referenceProvider.provideCodeLenses(documents.get(handler.textDocument.uri));
        result.then((lenses: ReferencesCodeLens[]) => {
            lenses.forEach((lens: ReferencesCodeLens) => {
                codeLenses[JSON.stringify(getCodeLens(lens))] = lens;
            });
        });
        return result;
    });
}

function getCodeLens(referenceCodeLens: ReferencesCodeLens): CodeLens {
    return { command: referenceCodeLens.command, data: referenceCodeLens.data, range: referenceCodeLens.range };
}

function sleep(ms: number) {
    return new Promise((resolve: any) => setTimeout(resolve, ms));
}

connection.onCodeLens((handler: CodeLensParams): Promise<ReferencesCodeLens[]> => {

    if (provider && provider.referenceProvider) {
        const result = provider.referenceProvider.provideCodeLenses(documents.get(handler.textDocument.uri));
        result.then((lenses) => {
            lenses.forEach((lens) => {
                codeLenses[JSON.stringify(getCodeLens(lens))] = lens;
            });
        });
        return result;
    } else {
        return waitForServer(handler);
    }
});

connection.onCodeLensResolve((handler: CodeLens) => {

    if (provider && provider.referenceProvider) {
        const item = codeLenses[JSON.stringify(handler)];
        if (item) {
            return provider.referenceProvider.resolveCodeLens(item);
        } else {
            console.error("key not found ");
            return new ResponseError(9903, "Could not resolve CodeLens: Key not Found");
        }
    }
    return new ServerNotReadyResponseError();
});

interface ISettings {
    dafny: IDafnySettings;
}

connection.onDidChangeConfiguration((change) => {
    settings = change.settings as ISettings;
    if (!started) {
        started = true;
        verifyDependencies();
    }
});

connection.onDidCloseTextDocument((handler) => {
    connection.sendDiagnostics({ diagnostics: [], uri: handler.textDocument.uri });
});

connection.onRequest<ICompilerResult, void>(LanguageServerRequest.Compile, (uri: Uri) => {
    if (provider && provider.compiler) {
        return provider.compiler.compile(uri);
    }
    return new ServerNotReadyResponseError();
});

connection.onRequest<string, void>(LanguageServerRequest.Install, () => {
    return new Promise<string>(async (resolve, reject) => {
        uninstallDafny().then(() => {
            if (dafnyInstaller) {
                dafnyInstaller.install().then((basePath) => {
                    settings.dafny.basePath = basePath;
                    verifyDependencies();
                    resolve(basePath);
                }).catch((e) => {
                    console.error("errrroooorrr: " + e);
                });
            } else {
                reject();
            }
        }).catch((e) => {
            reject(e);
        });
    });
});

connection.onRequest<void, void>(LanguageServerRequest.Uninstall, () => {
    return uninstallDafny();
});

function uninstallDafny(): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
        if (provider) {
            notificationService.progressText("Stopping dafny");
            provider.stop();
            await sleep(1000);
            let tries = 0;
            while (provider && provider.dafnyServer.isRunning() && tries < MAX_CONNECTION_RETRIES) {
                await sleep(1000);
                tries++;
            }
        }
        if (dafnyInstaller) {
            try {
                dafnyInstaller.uninstall();
                resolve();
            } catch (e) {
                notificationService.sendError("Error uninstalling: " + e);
                reject(e);
            }
        } else {
            reject();
        }
    });
}

connection.onRequest<void, void>(LanguageServerRequest.Reset, () => {
    if (provider) {
        provider.resetServer();
    }
    return;
});

connection.onNotification(LanguageServerNotification.Verify, (json: string) => {
    const textDocumentItem: TextDocumentItem = JSON.parse(json);
    const textDocument: TextDocument = TextDocument.create(textDocumentItem.uri, textDocumentItem.languageId,
        textDocumentItem.version, textDocumentItem.text);
    if (provider) {
        provider.doVerify(textDocument);
    }
});

connection.onNotification(LanguageServerNotification.CounterExample, (json: string) => {
    const textDocumentItem: TextDocumentItem = JSON.parse(json);
    const textDocument: TextDocument = TextDocument.create(textDocumentItem.uri, textDocumentItem.languageId,
        textDocumentItem.version, textDocumentItem.text);
    if (provider) {
        provider.doCounterExample(textDocument);
    }
});

connection.onCodeAction((params: CodeActionParams) => {
    if (provider && provider.codeActionProvider) {
        return provider.codeActionProvider.provideCodeAction(params);
    }
    return Promise.resolve([]);
});

connection.onCompletion((handler: TextDocumentPositionParams) => {
    if (provider && provider.completionProvider) {
        return provider.completionProvider.provideCompletion(handler);
    }
    return Promise.resolve([]);
});

connection.onHover((handler: TextDocumentPositionParams) => {
    console.log("asdf");
    if (provider && provider.hoverProvider) {
        return provider.hoverProvider.provideHover(documents.get(handler.textDocument.uri), handler.position);
    }
    return Promise.resolve({contents: ""});
});

connection.listen();
