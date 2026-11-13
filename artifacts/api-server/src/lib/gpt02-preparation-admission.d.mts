export type PreparationTask = {
  id:number;companyId:string;status:string;source:string|null;
  title:string;description:string|null;assignedToId:number|null;assignedTo:string|null
};
export type PreparationAudit = {id:number;after:string|null;userEmail:string|null};
export type PreparationActor = {id:string|number;email:string;role:string};
export type PreparationResult = Readonly<{
  eligible:boolean;reason:string;dispatchPermitted:false;operatorApprovalGranted:false;
  instruction?:string;taskId?:number;auditId?:number
}>;
export declare function assessGpt02PreparationAdmission(args:{
  task:PreparationTask|null;member:{id:number;name:string;isActive:boolean}|null;
  audit:PreparationAudit|null;actor:PreparationActor|null;companyId:string;
  existingExecutionCount?:number
}):PreparationResult;
