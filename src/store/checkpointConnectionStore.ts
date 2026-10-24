import { create } from 'zustand';
export const useCheckpointConnectionStore=create<{connected:boolean}>(()=>({connected:false}));
