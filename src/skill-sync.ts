import { basename } from 'node:path';
import { type Connection } from './contracts.ts';
import { requestJson } from './util.ts';
import { skillRepositoryId, syncSkills } from './skills.ts';

// Used by both prompt hooks and the explicit sync command. No repository contents
// are uploaded: the service receives only file hashes and status metadata.
export async function refreshSkills(root:string,config:Connection,token:string) {
  const repository=skillRepositoryId(root);
  const base=`${config.serverUrl}/api/projects/${encodeURIComponent(config.projectId)}`;
  const response=await requestJson(`${base}/skills${repository?`?repository=${encodeURIComponent(repository)}`:''}`,token);
  if(!response.release)throw new Error('No approved skill release is published');
  const result=syncSkills(root,response.release,response.resolutions??[]);
  let reportWarning:string|undefined;
  try {
    await requestJson(`${base}/skill-syncs`,token,'POST',{repositoryId:result.repositoryId,name:basename(root).slice(0,200)||'Repository',version:result.version,releaseHash:result.hash,files:result.files});
  }catch{reportWarning='Skills refreshed locally, but the dashboard sync status could not be delivered. Retry sync or send another prompt.';}
  return {...result,reportWarning};
}
