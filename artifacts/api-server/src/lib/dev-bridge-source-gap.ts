/** Read-only bridge source coverage. Missing records never enter the persisted job list. */
export const DEV_BRIDGE_SOURCE_GAP_SQL = `WITH missing AS (
 SELECT c.id::text AS command_id, c.status AS source_status, c.created_at,
  CASE
    WHEN c.command_type='HANDSHAKE_CONTINUE' THEN 'HANDSHAKE'
    WHEN c.metadata_json->>'capability'='chatgpt:wake'
      OR c.metadata_json ?| array['wakeBinding','assistantAttestationChallenge','accountAlias','browserProfile','gpt02TaskId']
      OR c.metadata_json->>'assignedClientId' IN ('openclaw-dell-chatgpt-wake-dev','openclaw-vmsc-chatgpt-wake-dev','openclaw-dell-admcst001-dev')
      THEN 'PROTECTED_WAKE'
    WHEN c.command_type='EVENT_BINDING' THEN 'PASSIVE_EVENT'
    ELSE 'OTHER_COMMAND'
  END AS category
 FROM ai_platform.ai_coding_bridge_commands c
 WHERE c.created_at >= now() - interval '14 days'
   AND c.status IN ('RECEIVED','PROCESSING','COMPLETED','FAILED')
   AND NOT EXISTS (SELECT 1 FROM ai_task_bridge.jobs j
     WHERE j.source='AI_CORE' AND j.external_id='bridge-command:'||c.id::text)
)
SELECT m.command_id,m.source_status,m.created_at,m.category,
 count(*) OVER()::integer AS total_count,
 CASE WHEN m.source_status IN ('COMPLETED','FAILED') THEN
   (SELECT count(*)=1 AND count(*) FILTER(WHERE r.kind=m.source_status AND r.acknowledged_at IS NOT NULL)=1
    FROM ai_platform.ai_coding_bridge_responses r WHERE r.command_id=m.command_id::uuid AND r.kind IN ('COMPLETED','FAILED'))
 ELSE false END AS source_ack_recorded
FROM missing m ORDER BY m.created_at DESC,m.command_id DESC LIMIT 100`;

export type DevBridgeSourceGap = {
  status: "AVAILABLE" | "UNAVAILABLE";
  lookbackDays: 14;
  total: number | null;
  rows: Array<{commandId:string;sourceStatus:string;createdAt:string;category:string;sourceAckRecorded:boolean}>;
};
type GapRow = {command_id:string;source_status:string;created_at:Date|string;category:string;source_ack_recorded:boolean;total_count:number};
export function unavailableDevBridgeSourceGap(): DevBridgeSourceGap {
  return {status:"UNAVAILABLE",lookbackDays:14,total:null,rows:[]};
}
export function projectDevBridgeSourceGap(rows: GapRow[]): DevBridgeSourceGap {
  if (rows.length>100) return unavailableDevBridgeSourceGap();
  const total=rows.length ? rows[0]!.total_count : 0;
  if (!Number.isSafeInteger(total) || total<rows.length || (rows.length<100 && total!==rows.length)) return unavailableDevBridgeSourceGap();
  const unique=new Set<string>();
  const projected:DevBridgeSourceGap["rows"]=[];
  for(const row of rows) {
    const date=new Date(row.created_at);
    if (row.total_count!==total || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.command_id) ||
        unique.has(row.command_id) || !["RECEIVED","PROCESSING","COMPLETED","FAILED"].includes(row.source_status) ||
        !["HANDSHAKE","PROTECTED_WAKE","PASSIVE_EVENT","OTHER_COMMAND"].includes(row.category) ||
        !Number.isFinite(date.getTime()) || typeof row.source_ack_recorded!=="boolean") return unavailableDevBridgeSourceGap();
    unique.add(row.command_id);
    projected.push({commandId:row.command_id,sourceStatus:row.source_status,createdAt:date.toISOString(),category:row.category,sourceAckRecorded:row.source_ack_recorded===true});
  }
  return {status:"AVAILABLE",lookbackDays:14,total,rows:projected};
}
