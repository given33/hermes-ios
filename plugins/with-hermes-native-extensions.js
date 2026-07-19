const { cpSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGETS = [
  {
    name: 'HermesWeatherWidget',
    type: 'app_extension',
    bundleIdentifier: 'app.sunstone1029.fig1171.weather-widget',
    source: 'HermesWeatherWidget.swift',
    platform: 'ios',
  },
  {
    name: 'HermesDeviceActivityMonitor',
    type: 'app_extension',
    bundleIdentifier: 'app.sunstone1029.fig1171.device-activity-monitor',
    source: 'HermesDeviceActivityMonitor.swift',
    platform: 'ios',
  },
  {
    name: 'HermesDeviceActivityReport',
    type: 'app_extension',
    bundleIdentifier: 'app.sunstone1029.fig1171.device-activity-report',
    source: 'HermesDeviceActivityReport.swift',
    platform: 'ios',
  },
  {
    name: 'HermesWatchApp',
    type: 'watch2_app',
    bundleIdentifier: 'app.sunstone1029.fig1171.watchapp',
    source: null,
    directory: 'HermesWatchApp',
    infoPlist: 'Info.plist',
    entitlements: 'HermesWatchApp.entitlements',
    platform: 'watchos',
  },
  {
    name: 'HermesWatchExtension',
    type: 'watch2_extension',
    bundleIdentifier: 'app.sunstone1029.fig1171.watchapp.watchkitextension',
    source: 'HermesWatchApp.swift',
    directory: 'HermesWatchApp',
    infoPlist: 'Extension-Info.plist',
    entitlements: 'HermesWatchApp.entitlements',
    platform: 'watchos',
  },
];

function unquote(value) {
  return String(value ?? '').replace(/^"|"$/g, '');
}

function findTarget(project, name) {
  const section = project.pbxNativeTargetSection();
  for (const [uuid, target] of Object.entries(section)) {
    if (uuid.endsWith('_comment') || !target || typeof target !== 'object') continue;
    if (unquote(target.name) === name) return { uuid, pbxNativeTarget: target };
  }
  return null;
}

function ensureDependencySections(project) {
  const objects = project.hash.project.objects;
  objects.PBXContainerItemProxy ??= {};
  objects.PBXTargetDependency ??= {};
}

function ensureTargetDependency(project, targetUuid, dependencyUuid) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const dependencies = project.hash.project.objects.PBXTargetDependency ?? {};
  const alreadyLinked = (target.dependencies ?? []).some(({ value }) => {
    const dependency = dependencies[value];
    return dependency && unquote(dependency.target) === dependencyUuid;
  });
  if (!alreadyLinked) project.addTargetDependency(targetUuid, [dependencyUuid]);
}

function targetConfigurations(project, target) {
  const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
  if (!list) throw new Error(`Missing build configuration list for ${unquote(target.pbxNativeTarget.name)}`);
  const section = project.pbxXCBuildConfigurationSection();
  return list.buildConfigurations.map(({ value }) => section[value]);
}

function addSourceGroup(project, name, sourcePaths) {
  if (project.pbxGroupByName(name)) return;
  // xcode's addPbxGroup serializes an omitted path as the literal `undefined`.
  // Keep the group rooted at the generated ios project so staged sources under
  // ios/native-extensions resolve from both Xcode and xcodebuild.
  const group = project.addPbxGroup(sourcePaths, name, '.');
  const firstProject = project.getFirstProject().firstProject;
  const mainGroup = project.hash.project.objects.PBXGroup[firstProject.mainGroup];
  mainGroup.children.push({ value: group.uuid, comment: name });
}

function configureTarget(project, definition, buildNumber, version) {
  const directory = definition.directory ?? definition.name;
  let target = findTarget(project, definition.name);
  if (!target) {
    target = project.addTarget(
      definition.name,
      definition.type,
      definition.name,
      definition.bundleIdentifier,
    );
    const sourcePaths = definition.source
      ? [`native-extensions/${directory}/${definition.source}`]
      : [];
    project.addBuildPhase(sourcePaths, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    addSourceGroup(project, definition.name, sourcePaths);
  }

  for (const configuration of targetConfigurations(project, target)) {
    const settings = configuration.buildSettings;
    const root = `$(SRCROOT)/native-extensions/${directory}`;
    settings.CLANG_ENABLE_MODULES = 'YES';
    settings.CODE_SIGN_ENTITLEMENTS = `"${root}/${definition.entitlements ?? `${definition.name}.entitlements`}"`;
    settings.CURRENT_PROJECT_VERSION = buildNumber;
    settings.GENERATE_INFOPLIST_FILE = 'NO';
    settings.INFOPLIST_FILE = `"${root}/${definition.infoPlist ?? 'Info.plist'}"`;
    settings.MARKETING_VERSION = version;
    settings.PRODUCT_BUNDLE_IDENTIFIER = `"${definition.bundleIdentifier}"`;
    settings.PRODUCT_NAME = '"$(TARGET_NAME)"';
    settings.SKIP_INSTALL = 'YES';
    settings.SWIFT_VERSION = '5.9';

    if (definition.platform === 'watchos') {
      settings.LD_RUNPATH_SEARCH_PATHS = '"$(inherited) @executable_path/Frameworks"';
      settings.SDKROOT = 'watchos';
      settings.SUPPORTED_PLATFORMS = '"watchos watchsimulator"';
      settings.TARGETED_DEVICE_FAMILY = '4';
      settings.WATCHOS_DEPLOYMENT_TARGET = '11.0';
    } else {
      settings.APPLICATION_EXTENSION_API_ONLY = 'YES';
      settings.IPHONEOS_DEPLOYMENT_TARGET = '18.0';
      settings.SDKROOT = 'iphoneos';
      settings.SUPPORTED_PLATFORMS = '"iphoneos iphonesimulator"';
      settings.TARGETED_DEVICE_FAMILY = '"1,2"';
    }
  }
  return target;
}

module.exports = function withHermesNativeExtensions(config) {
  const buildNumber = String(config.ios?.buildNumber ?? '').trim();
  const version = String(config.version ?? '').trim();
  if (!/^\d+$/.test(buildNumber) || Number(buildNumber) < 1) {
    throw new Error('Hermes native extensions require a positive iOS buildNumber');
  }
  if (!version) {
    throw new Error('Hermes native extensions require an Expo version');
  }
  const withSources = withDangerousMod(config, ['ios', async (modConfig) => {
    const source = resolve(modConfig.modRequest.projectRoot, 'native-extensions');
    const destination = resolve(modConfig.modRequest.platformProjectRoot, 'native-extensions');
    rmSync(destination, { force: true, recursive: true });
    cpSync(source, destination, { recursive: true });
    return modConfig;
  }]);
  return withXcodeProject(withSources, (modConfig) => {
    const project = modConfig.modResults;
    ensureDependencySections(project);
    const targets = new Map(
      TARGETS.map((definition) => [
        definition.name,
        configureTarget(project, definition, buildNumber, version),
      ]),
    );
    const appTarget = project.getFirstTarget();
    for (const name of [
      'HermesWeatherWidget',
      'HermesDeviceActivityMonitor',
      'HermesDeviceActivityReport',
      'HermesWatchApp',
    ]) {
      ensureTargetDependency(project, appTarget.uuid, targets.get(name).uuid);
    }
    ensureTargetDependency(
      project,
      targets.get('HermesWatchApp').uuid,
      targets.get('HermesWatchExtension').uuid,
    );
    return modConfig;
  });
};

module.exports.TARGETS = TARGETS;
