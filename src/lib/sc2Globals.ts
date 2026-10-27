// Funções e tabelas globais do lado da simulação do Supreme Commander 2 (o que existe para os
// scripts de mods em tempo de jogo). Lista tirada de um dump real do jogo publicado no projeto
// supcom2reversal (Synraw, domínio público — The Unlicense): github.com/Synraw/supcom2reversal
// (notes/dump_simglobals.txt). Usada no autocompletar e na ajuda da Forja.
import { t } from "./i18n";

/** 461 funções globais da simulação */
export const SIM_FUNCTIONS: readonly string[] = [
  "AddAgentConstantForce", "AddAgentFalloffForce", "AddBuildRestriction", "AddMarker", "AddUnitUpgrade", "AITarget",
  "ApplyBuff", "ArmyGetHandicap", "ArmyInitializePrebuiltUnits", "ArmyIsCivilian", "ArmyIsOutOfGame",
  "ArmySetIgnoreWaterBuildCap", "assert", "AttachBeamEntityToEntity", "AttachBeamsOnProjectile",
  "AttachBeamToEntity", "AttachEffectsOnProjectile", "AttachPolytrailsOnProjectile", "AudioSetLanguage", "Basename",
  "BeginLoggingStats", "BeginSession", "BlueprintLoaderUpdateProgress", "BOOLEAN", "BuffAffectUnit", "BuffCalculate",
  "BuffWorkThread", "CameraSetMinNearClipNIS", "CancelCountdown", "ChangeState", "ChangeUnitArmy", "CheatsEnabled",
  "CleanupEffectBag", "collectgarbage", "ConvertCClassToLuaClass", "CoordinateAttacks", "CreateAimController",
  "CreateAnimator", "CreateAttachedBeam", "CreateAttachedEmitter", "CreateAttachedEmitters", "CreateAttachedUnit",
  "CreateAttachLight", "CreateBeamEmitter", "CreateBeamEmitterOnEntity", "CreateBeamEntityToEntity",
  "CreateBeamToEntityBone", "CreateBlueSolidBuildBeams", "CreateBlueWavyBuildBeams", "CreateBoneEffects",
  "CreateBuildAssistBeams", "CreateBuilderArmController", "CreateBuildSliceBeams", "CreateCollisionDetector",
  "CreateCybranBuildBeams", "CreateDecal", "CreateDialogue", "CreateEconomyEvent", "CreateEffectsWithRandomOffset",
  "CreateEmitterAtBone", "CreateEmitterAtEntity", "CreateEmitterOnEntity", "CreateEmitterPositionVector",
  "CreateEmittersAtBone", "CreateEmittersAtEntity", "CreateEmittersOnEntity", "CreateFootPlantController",
  "CreateImpactEffectsOnProjectileCollision", "CreateInitialArmyUnit", "CreateLight", "CreateLightParticle",
  "CreatePrefetchSet", "CreateProp", "CreatePropHPR", "CreatePropResource", "CreateRepairBeams",
  "CreateResourceDeposit", "CreateRotator", "CreateSimSyncCameraRequest", "CreateSimSyncGameResult",
  "CreateSimSyncPlayerQuery", "CreateSimSyncPlayerQueryResults", "CreateSimSyncSound", "CreateSimSyncVoice",
  "CreateSlaver", "CreateSlider", "CreateSplat", "CreateSplatOnBone", "CreateStorageManip", "CreateTeleportEffects",
  "CreateTerrainImpactEffects", "CreateThrustController", "CreateTrail", "CreateTurnController", "CreateUnit",
  "CreateUnit2", "CreateUnitAtBone", "CreateUnitHPR", "CreateWeaponMuzzleFlashEffect", "CreateWreckageEffects",
  "CurrentThread", "Damage", "DamageArea", "DamageRing", "DebugGetSelection", "DefaultPrefetchSet",
  "DestroyAttachLight", "DestroyLight", "DestroySession", "Dirname", "dirty_module", "DiskFindFiles",
  "DiskGetFileInfo", "DiskToLocal", "dofile", "doscript", "doscriptConditional", "DrawCircle", "DrawLine",
  "DrawLinePop", "dump_table", "EconomyEventIsDone", "EnableReticleDrift", "EndGame", "EndLoggingStats",
  "EntityCategoryContains", "EntityCategoryCount", "EntityCategoryCountAroundPosition", "EntityCategoryEmpty",
  "EntityCategoryFilterDown", "EntityCategoryGetUnitList", "EnumColorNames", "error", "EulerToQuaternion", "exists",
  "Extends", "Extends2", "Extends3", "FileCollapsePath", "FlattenMapRect", "FLOAT", "FloatingEntityText",
  "FlushIntelInRect", "ForkThread", "GenerateArmyStart", "GenerateRandomOrientation", "GetArmyBrain",
  "GetArmyUnitCap", "GetArmyUnitCostTotal", "GetAverageBoundingXYZRadius", "GetBlueprint", "GetBuildVersion",
  "GetCameraPositionAndZoom", "GetCameraRotationAngle", "GetClosestMarker", "GetCommandLineArg",
  "GetCurrentCommandSource", "GetDeadReckonWithSpeed", "GetEntitiesInRect", "GetEntityById", "getfenv",
  "GetFiringVelocityWithHeight", "GetFocusArmy", "GetGameTick", "GetGameTimeSeconds", "GetMapSize", "getmetatable",
  "GetMovieDuration", "GetNonShadowedBlueprintSource", "GetPrefetchList", "GetReclaimablesInRect",
  "GetSurfaceHeight", "GetSystemTimeSecondsOnlyForProfileUse", "GetTargetPosition", "GetTargetUnit",
  "GetTerrainHeight", "GetTerrainType", "GetTerrainTypeOffset", "GetUnitBlueprintByName", "GetUnitById",
  "GetUnitsFromGroupTable", "GetUnitsInRect", "GetUnitSizes", "GetVersion", "GetWaterHeight", "GetXboxLanguageId",
  "GetXboxLocaleRatingsId", "GrantAllResearchToArmies", "GROUP", "HasBuff", "HasCommandLineArg", "HashString",
  "HasLocalizedVO", "import", "importConditional", "InitializeArmyAI", "InitializePrebuiltUnits", "INTEGER",
  "ipairs", "IsAlly", "IsBlip", "iscallable", "IsCollisionBeam", "IsCommand", "IsCommandDone", "IsDestroyed",
  "IsEnemy", "IsEntity", "IsGameOver", "IsInstance", "IsNeutral", "IsProjectile", "IsProp", "IsRetailBuild",
  "IssueAbility", "IssueAggressiveMove", "IssueAttack", "IssueBuildFactory", "IssueBuildMobile", "IssueCapture",
  "IssueClearCommands", "IssueClearFactoryCommands", "IssueDestroySelf", "IssueDive", "IssueEscort",
  "IssueFactoryAssist", "IssueFactoryRallyPoint", "IssueFerry", "IssueFormAggressiveMove", "IssueFormAttack",
  "IssueFormMove", "IssueFormPatrol", "IssueGuard", "IssueKillSelf", "IssueMove", "IssueMoveOffFactory", "IssueNuke",
  "IssuePatrol", "IssuePause", "IssuePodDock", "IssueReclaim", "IssueRepair", "IssueSacrifice", "IssueScript",
  "IssueSiloBuildNuke", "IssueStop", "IssueTeleport", "IssueTeleportToBeacon", "IssueTransportLoad",
  "IssueTransportUnload", "IssueTransportUnloadSpecific", "IssueUpgrade", "IsUnit", "IsXbox", "KillThread",
  "Knockback", "KnockbackScaledByRadius", "kpairs", "language", "LightClass", "LightFxEnable",
  "LightFxStartSequence", "ListArmies", "load", "loadfile", "loadstring", "LOC", "LOC_ALL", "LocExpand", "LOCF",
  "LockInput", "LOG", "LUnitMove", "LUnitMoveNear", "MATH_IRound", "MATH_Lerp", "MetaImpact", "MinLerp", "MinSlerp",
  "module", "newproxy", "next", "NoteFocusArmyChanged", "NotifyUpgrade", "OkayToMessWithArmy", "OnCreateArmyBrain",
  "OnPostLoad", "OrientFromDir", "pairs", "ParseEntityCategory", "ParseEntityCategoryEx", "pcall",
  "PhysicsSetAirDensity", "PhysicsSetGravity", "PhysicsSetWaterDensity", "PlayBuffEffect", "PlayCaptureEffects",
  "PlayReclaimEffects", "PlayReclaimEndEffects", "PointVector", "PostInitWeaponBlueprint", "PreloadUnits", "print",
  "PrintBuffs", "PrintText", "QRotate", "QUATERNION", "Random", "RandomIter", "rawequal", "rawget", "rawset", "Rect",
  "RECTANGLE", "RegisterAbilityBlueprint", "RegisterAiSkirmishArchetypeBlueprint", "RegisterAiSkirmishBaseBlueprint",
  "RegisterAiSkirmishEngineerBlueprint", "RegisterAiSkirmishFactoryBlueprint", "RegisterAiSkirmishFormBlueprint",
  "RegisterAiSkirmishResponseBlueprint", "RegisterAnimPackBlueprint", "RegisterAnimTreeBlueprint",
  "RegisterBeamBlueprint", "RegisterEmitterBlueprint", "RegisterEntityCostumeBlueprint",
  "RegisterEntityCostumeSetBlueprint", "RegisterMeshBlueprint", "RegisterPlatoonBlueprint",
  "RegisterProjectileBlueprint", "RegisterPropBlueprint", "RegisterRawAnimBlueprint",
  "RegisterTrailEmitterBlueprint", "RegisterUnitBlueprint", "RegisterVendorBlueprint",
  "RegisterVendorCostumeItemBlueprint", "RegisterVendorWeaponItemBlueprint", "RegisterWeaponBlueprint",
  "RemoveAllUnitUpgrades", "RemoveBuff", "RemoveBuildRestriction", "RemoveEconomyEvent", "RemoveUnitUpgrade", "repr",
  "RequestAllArmyStatsSyncArmy", "require", "ResetSyncTable", "RestrictEscapePods", "ResumeThread", "safecall",
  "ScaleEmittersParam", "SecondsPerTick", "select", "SelectedUnit", "SetAlliance", "SetAllianceOneWay",
  "SetAlliedVictory", "SetAmbientReverb", "SetArmyAIPersonality", "SetArmyColor", "SetArmyColorIndex",
  "SetArmyEconomy", "SetArmyFactionIndex", "SetArmyHandicap", "SetArmyOutOfGame", "SetArmyPlans", "SetArmyShowScore",
  "SetArmyStart", "SetArmyStatsSyncArmy", "SetArmyUnitCap", "setfenv", "SetIgnoreArmyUnitCap",
  "SetIgnorePlayableRect", "SetLocalizedFEV", "setmetatable", "SetPlayableRect", "SetSkirmishAmphibiousMap",
  "SetSkirmishLandMap", "SetSkirmishResearchNotRequired", "SetTerrainType", "SetTerrainTypeRect",
  "SetUIBuildRestrictions", "SetupSession", "ShouldCreateInitialArmyUnits", "SimConExecute", "SimRequestPause",
  "SimResume", "sort_by", "sort_down_by", "sortedpairs", "SortEntitiesByDistanceXZ", "Sound",
  "SourceAndDestPathableAmphibious", "SourceAndDestPathableLand", "SpawnLavaPlumes", "SpecFootprints", "SPEW",
  "SplitProp", "StartCountdown", "STR_GetTokens", "STR_itox", "STR_Utf8Len", "STR_Utf8SubString", "STR_xtoi",
  "STRING", "StunArea", "SubmitEliminatedArmyStats", "SubmitVictoryArmyStats", "SubmitXMLArmyStats",
  "SuspendCurrentThread", "SyncPlayableRect", "SyncUnitUpgrades", "tab_find_exists", "tonumber", "tostring", "Trace",
  "TryCopyPose", "type", "UIAreMoviesFinished", "UIGetTransitionToGame", "UISetEnableWhitespaceWordWrap",
  "UISetLanguageId", "UISetMovieAudioTrack", "UISetMovieSubtitleChannel", "UnlockAllResearch",
  "UnlockAllUnitsNoResearch", "UnlockInput", "unpack", "VAdd", "VAngleBetween", "VCross", "VDiff", "VDist2",
  "VDist2Sq", "VDist3", "VDist3Sq", "VDist3XZ", "VDist3XZSq", "VDot", "Vector", "Vector2", "VECTOR2", "VECTOR3",
  "VLength", "VLengthSq", "VLengthXZ", "VLengthXZSq", "VMult", "VNormal", "VPerpDot", "VRotateAxisAngle", "VRotateX",
  "VRotateY", "VRotateZ", "VSetMagnitude", "WaitFor", "WaitSeconds", "WaitTicks", "WARN", "Warp", "xpcall",
];

/** 51 tabelas globais da simulação (categories, ScenarioInfo, math…) */
export const SIM_TABLES: readonly string[] = [
  "ArmyBonusBlueprint", "ArmyBonusDefMeta", "ArmyBonuses", "ArmyBrains", "BaseBuilderTemplate",
  "BaseBuilderTemplateDefMeta", "BaseBuilderTemplates", "bitlib", "BuffAffects", "BuffBlueprint", "BuffDefMeta",
  "Buffs", "Builder", "BuilderDefMeta", "BuilderGroup", "BuilderGroupDefMeta", "BuilderGroups", "Builders",
  "Callback", "categories", "Class", "coroutine", "debug", "EffectTemplates", "Experience", "io", "kore",
  "LocGlobals", "LocSubtitleChannels", "math", "mmt", "moho", "os", "package", "PlatoonTemplate",
  "PlatoonTemplateDefMeta", "PlatoonTemplates", "profile", "ResearchDefinitions", "ResearchExperience", "Scenario",
  "ScenarioInfo", "serialize", "SimUnitUpgrades", "State", "StateProxyTag", "string", "Sync", "table", "TrashBag",
  "UnitData",
];

/** Prefixos das famílias de funções, para a ajuda ao passar o mouse. */
const FAMILY: [RegExp, () => string][] = [
  [/^Issue/, () => t("Dá uma ordem às unidades (lista de unidades, alvo/posição…).")],
  [/^Create/, () => t("Cria algo no mundo (efeito, luz, unidade, prop, decalque…) e devolve o objeto criado.")],
  [/^Army/, () => t("Consulta ou muda um exército (índice ou nome do exército).")],
  [/^(Attach|Detach)/, () => t("Prende ou solta efeitos/feixes de um osso ou entidade.")],
  [/^Buff/, () => t("Sistema de buffs (bônus temporários nas unidades).")],
  [/^(V[A-Z]|MATH_)/, () => t("Matemática de vetores/números do motor.")],
  [/^(UI|Sim)/, () => t("Interface ou sincronização entre a simulação e a interface.")],
  [/^(Get|Is|Has)/, () => t("Consulta: devolve um valor sem mudar o jogo.")],
  [/^(Set|Add|Remove)/, () => t("Muda uma configuração ou estado do jogo.")],
];

export function simHelp(name: string): string | null {
  if (SIM_TABLES.includes(name)) return t("Tabela global da simulação do SC2.");
  if (!SIM_FUNCTIONS.includes(name)) return null;
  const fam = FAMILY.find(([re]) => re.test(name));
  const base = t("Função global da simulação do SC2.");
  return fam ? `${base} ${fam[1]()}` : base;
}
