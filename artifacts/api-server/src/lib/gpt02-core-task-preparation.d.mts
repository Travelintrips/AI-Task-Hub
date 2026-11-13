export type PreparedCoreTask = Readonly<{
  coreTaskId:string;commandCandidateId:string;attemptId:string;hubExecutionId:string;
  preparedNew:boolean;coreTaskStatus:"PENDING";hubExecutionStatus:"prepared";
  commandIssued:false;operatorApprovalRecorded:false;issuerGrantReady:false;
  dispatchPermitted:false;lifecycleStartPermitted:false;readOnly:false;environment:"DEV"
}>;
export declare function createCoreTaskPreparer(args:{
  env:NodeJS.ProcessEnv;PoolClass:new (config:unknown)=>unknown
}):{preparer:{prepare(input:{
    companyId:string;hubTaskId:number;projectName:string;
    repository:string;branch:string;instruction:string
  }):Promise<PreparedCoreTask>};close():Promise<void>};
