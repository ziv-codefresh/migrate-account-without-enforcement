const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('cf-logs');
const { writeFileSync } = require('fs');
const { MongoClient } = require('mongodb');

const possibleAccountNames = [
    'flowmill',
    'leads2b',
    'urbint',
    'palsoncf',
    'circle',
    'digistore24',
    'somos',
    'elmington-tech',
    'gymshark',
    'motorefi',
    'vendasta',
    'linioit',
    'skyslope',
    'bread',
    'apex-clearing',
    'ascentialedge',
    'auditboard',
    'npr-infra-test',
    'paceup',
    'saffisandbox',
    'octadesk',
    'orenweingrod',
    'spaceiq',
    'intsights',
    'monday',
    'aleksandr-codefresh',
    'deloittehux',
    'istreamplanet-broadcast',
    'nazarcodefresh',
    'peerstreet',
    'b-yond',
    'legalshieldcorp',
    'freedomofpress',
    'guysalton',
    'lirantal',
    'move',
    'rtl2',
    'softteco',
    'crux-testing-github',
    'deniscodefresh',
    'epic',
    'lianatech',
    'ovandenbos-imb',
    'pdq',
    'photoboxgroupsandbox',
    'v-for-venona',
    'vivint',
    'aparna',
    'dovemed',
    'dronedeploy',
    'dzirkler',
    'guozeng',
    'jacobberube',
    'pracavoipzilla',
    'robbcrg',
    'roi-test5',
    'roicodefresh',
    'roitest',
    'samasource',
    'shinsegae-inc',
    'woodcut',
    'xinczhang',
    'yaroslav-codefresh',
    'andriicodefresh',
    'aplorian-labs',
    'cf-support',
    'chrisrpatterson',
    'damicodefresh',
    'fbaldo31',
    'findhotel',
    'ge',
    'geswitch',
    'get_fabric',
    'gr-oeg',
    'gruponeolife',
    'icware',
    'inselo',
    'jagshetty',
    'kairosinc',
    'lacework',
    'lfurrea',
    'macerich',
    'mikhail-klimko',
    'oceaneering',
    'orentest3',
    'pasha-codefresh_github',
    'roi-test3',
    'sharonvendrov',
    'sonder-inc',
    'streamion',
    'tblsoft',
    'tconio',
    'tgadam',
    'vadimkharincodefresh',
    'verimatrix',
    'vfarciccfpersonal',
    'weedmaps',
    'zivcodefresh'
];

const accountName = process.env.ACCOUNT_NAME;
let accountId
let accounts = null;
let pipelines = null;
let runtimeEnvironments = null;
let defaultRuntime = null;

async function initMongoClients() {
    logger.info('Connecting to db...');
    const [apiClient, pipelineClient, runtimeClient] = await Promise.all([
        MongoClient.connect(process.env.MONGO_URI, { promiseLibrary: Promise, useNewUrlParser: true  }),
        MongoClient.connect(process.env.PIPELINE_MANAGER_MONGO_URI, { promiseLibrary: Promise, useNewUrlParser: true  }),
        MongoClient.connect(process.env.RUNTIME_ENVIRONMENT_MANAGER_MONGO_URI, { promiseLibrary: Promise, useNewUrlParser: true  }),
    ]);

    accounts = apiClient.db().collection('accounts');
    pipelines = pipelineClient.db().collection('pipelines');
    runtimeEnvironments = runtimeClient.db().collection('runtime-environment');
    defaultRuntime = runtimeClient.db().collection('defaults');
    logger.info('Connected to db.');
}

async function getAccountIdByName() {
    try {
        const account = await accounts.findOne({ name: accountName });
        if (!account){
            throw new Error(`account: ${accountName} was not found`)
        }
        accountId = account._id;
    } catch (err) {
        logger.error(`failed to get account ${accountId}`);
        throw err;
    }
}

async function removeRuntimeFromAccountPipelines() {
    const errors = [];
    const pipelinesCursor = await pipelines.find({$and: [{'metadata.accountId': accountId}, {'spec.runtimeEnvironment.name' : /system/} ] } );
    let curPipeline;
    let counter = 0;

    while ((curPipeline = await pipelinesCursor.next())) {
        try {
            await pipelines.updateOne({ _id: curPipeline._id }, { $unset: { 'spec.runtimeEnvironment': '' } });
            logger.info(`runtime: ${curPipeline.spec.runtimeEnvironment.name} has been removed from pipeline: ${curPipeline.metadata.name}`);
            counter += 1;
        } catch (err) {
            logger.error(`failed to get pipeline "${curPipeline.metadata.name}": ${JSON.stringify(err)}`);
            errors.push({
                account: { id: curPipeline._id.toString(), name: curPipeline.metadata.name },
                cause: err
            });
        }
    }

    logger.info(`finished! ${counter} pipelines`);
    logger.info(`had ${errors.length} errors!`)

    if (errors.length) {
        const filename = './report.json';
        writeFileSync(filename, JSON.stringify(errors));
        logger.info(`written errors to file "${filename}"!`);
    }
}

async function removeSystemDefaultRuntime() {
    const errors = [];
    const defaultRuntimeCursor = await defaultRuntime.find({ $and: [{ 'runtimeEnvironmentName': /system/ }, { accountId }] });
    let curRuntime;
    let counter = 0;

    while ((curRuntime = await defaultRuntimeCursor.next())) {
        try {
            await defaultRuntime.deleteOne({ $and: [{ 'runtimeEnvironmentName': curRuntime.runtimeEnvironmentName }, { accountId }] });
            logger.info(`default runtime: ${curRuntime.runtimeEnvironmentName} has been removed for account: ${accountName}`);
            counter += 1;
        } catch (err) {
            logger.error(`failed remove default account from runtime "${curRuntime.runtimeEnvironmentName}": ${JSON.stringify(err)}`);
            errors.push({
                account: { id: curRuntime._id.toString(), name: curRuntime.metadata.name },
                cause: err
            });
        }
    }

    logger.info(`finished! ${counter} runtime`);
    logger.info(`had ${errors.length} errors!`)

    if (errors.length) {
        const filename = './report.json';
        writeFileSync(filename, JSON.stringify(errors));
        logger.info(`written errors to file "${filename}"!`);
    }
}

async function removeAccountFromRuntime() {
    const errors = [];
    const runtimeCursor = await runtimeEnvironments.find({ $and: [{ 'metadata.name': /system/ }, { accounts: { $in: [ accountId ] } }] });
    let curRuntime;
    let counter = 0;

    while ((curRuntime = await runtimeCursor.next())) {
        try {
            await runtimeEnvironments.updateOne({ _id: curRuntime._id }, { $pull: { accounts: { $in: [accountId] } } });
            logger.info(`account: ${accountName} has been removed from runtime: ${curRuntime.metadata.name}`);
            counter += 1;
        } catch (err) {
            logger.error(`failed to get runtime "${curRuntime.metadata.name}": ${JSON.stringify(err)}`);
            errors.push({
                account: { id: curRuntime._id.toString(), name: curRuntime.metadata.name },
                cause: err
            });
        }
    }

    logger.info(`finished! ${counter} runtime`);
    logger.info(`had ${errors.length} errors!`)

    if (errors.length) {
        const filename = './report.json';
        writeFileSync(filename, JSON.stringify(errors));
        logger.info(`written errors to file "${filename}"!`);
    }
}

async function run() {
    if (!accountName) {
        throw new Error('Account name must be provided')
    }
    if (_.indexOf(possibleAccountNames, accountName) === -1 ){
        throw new Error(`Account: ${accountName} is not one of the possible option - please contact with dev`)
    }
    await initMongoClients();
    await getAccountIdByName();
    await removeRuntimeFromAccountPipelines();
    await removeSystemDefaultRuntime();
    await removeAccountFromRuntime();
    process.exit(0);
}

run()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
