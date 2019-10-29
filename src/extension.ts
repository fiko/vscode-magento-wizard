import * as vscode from 'vscode';
import createQuickPickCustom, { QuickPickCustomOptons } from './quickPickCustom';
import magento, { ExtensionInfo }  from './magento';
import createExtension from './actions/createExtension';
import injectDependency from './actions/injectDependency';
import addObserver from './actions/addObserver';
import addPlugin from './actions/addPlugin';

async function getVendorExtension(options?: QuickPickCustomOptons): Promise<ExtensionInfo | undefined> {
    if (!options) {
        options = {};
    }
    options.step = options.step || 1;
    options.totalSteps = options.totalSteps || 2;
    let currentWorkspace: vscode.WorkspaceFolder | undefined;
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folders found');
    }
    currentWorkspace = vscode.workspace.workspaceFolders[0];
    if (vscode.workspace.workspaceFolders.length > 1) {
        currentWorkspace = await vscode.window.showWorkspaceFolderPick();
    } else {
        currentWorkspace = vscode.workspace.workspaceFolders[0];
    }
    if (!currentWorkspace) {
        return undefined;
    }
    magento.folder = currentWorkspace;
    let vendors = magento.getVendors();
    let vendor = await createQuickPickCustom(vendors, Object.assign({}, options, { title: 'Please select Vendor' }));
    let extension;
    if (vendor) {
        options.step++;
        if (options.custom) {
//                extension = await vscode.window.showInputBox({ placeHolder: 'Enter Extension Name'});
            extension = await createQuickPickCustom([], Object.assign({}, options, { title: 'Enter Extension Name' }));
        } else {
            let extensions = magento.getExtensions(vendor);
            extension = await createQuickPickCustom(extensions, Object.assign({}, options, { title: 'Please select Extension' }));
        }
        if (extension) {
            let extensionFolder = `app/code/${vendor}/${extension}`;
            return {
                workspace: currentWorkspace,
                vendor,
                extension,
                extensionFolder,
                extensionUri: magento.appendUri(currentWorkspace.uri, extensionFolder),
            };
        }
    } else {
        return undefined;
    }
}


export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('magentowizard.newExtension', async () => {
        const data = await getVendorExtension({ custom: true });
        if (!data) {
            return;
        }
        try {
            await createExtension(data.vendor, data.extension);
            vscode.window.showInformationMessage(`Created extension ${data.vendor}_${data.extension}`);
        } catch (e) {
            vscode.window.showErrorMessage(e.message);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('magentowizard.injectDependency', async () => {
        let textEditor = vscode.window.activeTextEditor;
        try {
            if (!textEditor || textEditor.document.languageId !== 'php') {
                throw new Error('Only supported for PHP files');
            }
            let data = await magento.getUriData(textEditor.document.uri);
            if (!data.vendor || !data.extension) {
                throw new Error('Not a Magento 2 extension file');
            }
            let folder = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
            if (folder) {
                magento.folder = folder;
            }
            if (textEditor) {
                let className = await createQuickPickCustom(magento.getClasses(data), { step: 1, totalSteps: 2, title: 'Please select class or interface to inject' });
                if (className) {
                    var varName = await vscode.window.showInputBox({
                        prompt: 'Enter variable name',
                        value: magento.suggestVariableName(className),
                        validateInput: value => { return !value.match(/^\$?[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*$/) ? 'Incorrect variable name' : '' ; },
                    });
                    if (varName) {
                        await injectDependency(textEditor, className, varName);
                    }
                }
            }
        } catch(e) {
            vscode.window.showErrorMessage(e.message);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('magentowizard.addObserver', async () => {
        let textEditor = vscode.window.activeTextEditor;
        let step, totalSteps;
        try {
            let extensionData;
            if (textEditor) {
                try {
                    extensionData = await magento.getUriData(textEditor.document.uri);
                    totalSteps = 2;
                    step = 1;
                } catch {}
            }
            if (!extensionData || !extensionData.vendor || !extensionData.extension) {
                totalSteps = 4;
                step = 3;
                extensionData = await getVendorExtension({ custom: false, totalSteps });
            }
            if (!extensionData || !extensionData.vendor || !extensionData.extension) {
                return;
            }
            let eventName = await createQuickPickCustom(magento.getEvents(), { step, totalSteps, title: 'Please select event name' });
            if (eventName) {
                var observerName = await vscode.window.showInputBox({
                    prompt: 'Enter observer class name',
                    value: magento.suggestObserverName(eventName),
                    validateInput: value => { return !magento.validateClassName(value) ? 'Incorrect class name' : '' ; },
                });
                if (observerName) {
                    await addObserver(extensionData, eventName, observerName!);
                }
            }
        } catch (e) {
            vscode.window.showErrorMessage(e.message);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('magentowizard.addPlugin', async () => {
        let textEditor = vscode.window.activeTextEditor;
        let step = 1, totalSteps = 4;
        // try {
            let extensionData;
            if (textEditor) {
                try {
                    extensionData = await magento.getUriData(textEditor.document.uri);
                } catch {}
            }
            if (!extensionData || !extensionData.vendor || !extensionData.extension) {
                totalSteps = 6;
                step = 3;
                extensionData = await getVendorExtension({ custom: false, totalSteps });
            }
            if (!extensionData || !extensionData.vendor || !extensionData.extension) {
                return;
            }
            let className = await createQuickPickCustom(magento.getClasses(extensionData), { custom: true, step, totalSteps, title: 'Please enter or select class in which you want to intercept method call' });
            if (!className) { return; }

            let classFile = magento.getClassFile(extensionData, className);

            let methods: string[] = [];
            if (classFile) {
                methods = await magento.getClassMethods(classFile);
            }
            step++;
            let methodName = await createQuickPickCustom(methods, { custom: true, step, totalSteps, title: 'Please enter or select method you want to intercept' });
            if (!methodName) { return; }

            step++;
            let pluginType = await createQuickPickCustom(['before', 'after', 'around'], { custom: false, step, totalSteps, title: 'Please select plugin type' });
            if (!pluginType) { return; }

            var pluginName = await vscode.window.showInputBox({
                prompt: 'Enter plugin class name',
                value: magento.suggestPluginName(className),
                validateInput: value => { return !magento.validateClassName(value) ? 'Incorrect class name' : '' ; },
            });
            if (!pluginName) { return; }

            await addPlugin(extensionData, className, methodName, pluginType, pluginName);
        // } catch (e) {
        //     vscode.window.showErrorMessage(e.message);
        // }
    }));

    let lastOpenedDocument: vscode.TextDocument | undefined;
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(textDocument => {
        lastOpenedDocument = textDocument;
    }));
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(textEditors => {
        const activeEditor = vscode.window.activeTextEditor;
        if (lastOpenedDocument && activeEditor && activeEditor.document.uri.toString() === lastOpenedDocument.uri.toString()) {
            magento.applyTemplate(activeEditor);
        }
        lastOpenedDocument = undefined;
    }));
}

// this method is called when your extension is deactivated
export function deactivate() {}
