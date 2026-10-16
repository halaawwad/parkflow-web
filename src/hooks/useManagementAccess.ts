import { useQuery } from '@tanstack/react-query';
import { managementService } from '@/services/http/managementService';
import { useAuthStore } from '@/store/authStore';

export function useManagementAccess(){
  const user=useAuthStore(s=>s.user);
  return useQuery({queryKey:['management','access',user?.id],queryFn:managementService.access,enabled:Boolean(user?.id),staleTime:0,refetchOnMount:'always'});
}
