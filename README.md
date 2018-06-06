# Dafny VSCode

This repository contains the infrastructure necessary to support _Dafny_ for Visual Studio Code.

# Architecture

The infrastructure consists of a _Dafny_ language server, which can be found in the [server](server/) directory, and a VS Code extension, which in turn can be found in the [client](client/) directory. These components communicate with each other using the [_Language Server Protocol (LSP)_](https://microsoft.github.io/language-server-protocol/).

## Contribute

We welcome all contributions! Please create a pull request and we will take care of releasing a new version when appropriate.

### How-To

It is pretty simple to contribute to this plugin. All it takes is having Visual Studio Code and npm installed. Simply clone this repository and switch into the new folder. Execute the following commands:

* `cd server`
* `npm install`
* `code .`
* `cd ../client`
* `npm install`
* `code .`

This opens the language server part and the client part of the plugin in two different Visual Studio Code editors and installs all the dependencies. In the server editor, press `CTRL+Shift+b` or `⇧+⌘+B` to compile. The task that is started also watches file changes and recompiles automatically after saving.

To try out the changes, go to the client editor and press `F5`. A new instance of Visual Studio Code will be started that has the Dafny plugin running and ready for testing. Sometimes, Visual Studio Code does not recognize changes and does not apply them to the running test instance. If this is the case, simply close and restart the test instance, the changes should then be applied.

If you wish to contribute, simply make your changes and submit a pull request. Make sure that your changes don't break the existing tests in the client/test folder. You can run the tests with `npm test` while in the client folder. Feel free to add any tests.

If you need to change the _DafnyServer_ itself, which should not often be the case, check with [Microsoft Dafny](https://github.com/Microsoft/dafny) in order to integrate your changes.

## Release

To release a new version of Dafny VSCode, follow the description in [RELEASE.md](RELEASE.md).

[![Analytics](https://ga-beacon.appspot.com/UA-98083145-1/FunctionalCorrectness/dafny-vscode?pixel)](https://github.com/FunctionalCorrectness/dafny-vscode)
