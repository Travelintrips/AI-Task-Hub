export type PreparerCatalogStatus = Readonly<{catalogReady:boolean;reason:string;dispatchPermitted:false}>;
export declare function assessGpt02PreparerCatalog(role:{
  role:string;canLogin:boolean;passwordVerifierReady:boolean;
  connectionLimit:number;activeSessions:number;memberships:number;
  superuser:boolean;bypassRls:boolean;createRole:boolean;createDb:boolean;
  replication:boolean;inherit:boolean;canCreateDatabase:boolean;
  validUntil:Date|string|null;
}|null,now?:number):PreparerCatalogStatus;
