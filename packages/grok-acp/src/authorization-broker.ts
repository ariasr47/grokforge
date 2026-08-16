import { compileFixedInspection } from "./inspection-grammar.js";
export type AuthorizationResult={decision:"auto"|"decision"|"refuse";automaticEligibility:"read"|"fixed_inspection"|"text_edit"|"bypass"|"not_eligible";reason?:string};
export type AuthorizationRequest={kind:"read"|"list"|"search"|"inspection"|"text_edit"|"shell"|string;path?:string;regularText?:boolean;exists?:boolean};
export class AuthorizationBroker {
  authorize(request:AuthorizationRequest,context:{mode:"review"|"trusted_workspace"|"bypass_permissions";confined?:boolean;inspection?:string}):AuthorizationResult {
    if((request.kind==="read"||request.kind==="list"||request.kind==="search")&&context.confined!==false)return {decision:"auto",automaticEligibility:"read"};
    if(request.kind==="inspection"&&context.confined===false&&context.mode!=="bypass_permissions")return {decision:"refuse",automaticEligibility:"not_eligible",reason:"outside_workspace"};
    if(request.kind==="inspection"&&context.inspection&&compileFixedInspection(context.inspection))return {decision:"auto",automaticEligibility:context.mode==="bypass_permissions"?"bypass":"fixed_inspection"};
    // Trusted mode permits ordinary regular-text creation as well as replacement;
    // `exists:false` is an eligible create, not a reason to fall back to prompting.
    if(request.kind==="text_edit"&&request.regularText&&context.mode==="trusted_workspace")return {decision:"auto",automaticEligibility:"text_edit"};
    if(context.mode==="bypass_permissions")return {decision:"auto",automaticEligibility:"bypass"};
    if(context.confined===false&&request.kind!=="shell")return {decision:"refuse",automaticEligibility:"not_eligible",reason:"outside_workspace"};
    return {decision:"decision",automaticEligibility:"not_eligible"};
  }
}
