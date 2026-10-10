"use strict";
// Stable message keys let each client render in its own language. Keep the
// original message in diagnostics; never translate wire/config identifiers.
function uiError(error){
  const text=String(error?.message||error);
  let match;
  if((match=/^Invalid (\w+): expected (\S+) to (\S+)$/.exec(text)))
    return {errorKey:'setting_range',errorParams:{setting:match[1],minimum:match[2],maximum:match[3]}};
  if((match=/^(\w+) must be true or false$/.exec(text)))
    return {errorKey:'boolean_error',errorParams:{setting:match[1]}};
  const rules=[
    [/Only a server owner|Only a server owner or GM/,'permission_error'],
    [/Policy changed in another window/,'revision_error'],
    [/Check interval must be/,'interval_error'],
    [/Warning threshold cannot exceed/,'warning_error'],
    [/Minimum batch cannot exceed/,'batch_range_error'],
    [/Unknown buying policy|Buying policy must be/,'invalid_setting'],
    [/Character login required/,'session_not_ready'],
    [/Invalid item, price|Invalid or oversized|Unexpected token|JSON/,'request_invalid']
  ];
  return {errorKey:rules.find(([pattern])=>pattern.test(text))?.[1]||'request_failed',errorParams:{}};
}
module.exports={uiError};
