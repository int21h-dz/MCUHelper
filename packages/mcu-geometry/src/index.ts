export type {
  BoundingBox,
  GeometryScene,
  LatticeInstance,
  MaterialInfo,
  NetInstance,
  PointQueryResult,
  PrimitiveSolid,
  SliceAxis,
  SliceGrid,
  SliceZoneMeta,
  Vec3,
  ZoneExpr,
  ZoneExprBodyRef,
  ZoneExprComplement,
  ZoneExprIntersect,
  ZoneExprUnion,
  ZoneSolid,
} from "./types";

export { colorForBody, colorForMaterial, colorForZone } from "./colors";
export { parseZoneExpression, collectBodyRefs, evalZoneExpr } from "./zoneExpression";
export { pointInBody, pointInBodyNode } from "./pointInBody";
export {
  bboxUnion,
  buildPrimitive,
  buildVars,
  emptyBbox,
  isGlobalScope,
} from "./primitives";
export { buildScene, sliceAtZ } from "./buildScene";
export { buildGeometryContext, queryPoint, buildSliceGrid, computeSceneBbox } from "./query";
export { buildLiveZonePreview } from "./liveZonePreview";
export { parseGltlPlacements } from "./gltl";
export { resolveNetCell, netPrototypeAt, cellPitchFromContainer } from "./netQuery";
export type { GeometryContext } from "./query";
export { resolveBodyRef, isBodyRefInHits } from "./bodyRefs";
export {
  MESH_PREVIEW_SUPPORTED,
  MESH_PREVIEW_UNSUPPORTED,
  MESH_PREVIEW_BODY_CAP,
  isMeshPreviewSupported,
  isMeshPreviewUnsupported,
  bodyToMeshDescriptor,
  buildMeshPreview,
  bboxGap,
  bboxFromBodyParams,
  selectNearbyBodies,
  selectNearbyBodiesWithGap,
  rankNearbyBodies,
  neighborColorByGap,
  neighborFadeDistance,
  buildDraftBodyPreview,
  DRAFT_BODY_COLOR,
  NEIGHBOR_BODY_COLOR,
  applyTransfToBodyParams,
  applyTransfToPrimitive,
  translateBodyParams,
  bodyAnchorPoint,
  normalizeTransfMode,
  transfPoint,
  TRANSF_FORBIDDEN_PROTOS,
  COPY_BODY_COLOR,
} from "./meshPreview";
export type {
  MeshKind,
  MeshDescriptor,
  UnsupportedMeshBody,
  MeshPreviewOptions,
  MeshPreviewResult,
  NearbyBodiesOptions,
  DraftBodyPreviewInput,
  DraftBodyPreviewResult,
} from "./meshPreview";
export type { LiveZonePreviewResult, LiveZonePreviewSlice } from "./liveZonePreview";
