//! Memória do jogo.
//!
//! O SC2 é um programa de 32 bits: sem a flag "Large Address Aware" ele enxerga 2 GB; com ela
//! (no Windows de 64 bits), 4 GB. Acima disso é impossível para um executável de 32 bits.
//! Entre 2 e 4 GB o jogador escolhe um teto de verdade: o launcher liga a flag e, quando o jogo
//! abre, coloca o processo num "Job Object" do Windows com limite de memória.

use serde::{Deserialize, Serialize};

/// Opções oferecidas (em MB). 2048 = original; 4096 = máximo do jogo.
pub const CHOICES_MB: &[u32] = &[2048, 2560, 3072, 3584, 4096];
pub const MIN_MB: u32 = 2048;
pub const MAX_MB: u32 = 4096;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    pub total_mb: u64,
    pub available_mb: u64,
}

pub fn system_memory() -> SystemMemory {
    use sysinfo::{MemoryRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram()));
    SystemMemory {
        total_mb: sys.total_memory() / 1_048_576,
        available_mb: sys.available_memory() / 1_048_576,
    }
}

/// Ajusta um valor qualquer para a opção válida mais próxima.
pub fn normalize_mb(mb: u32) -> u32 {
    *CHOICES_MB
        .iter()
        .min_by_key(|c| (**c as i64 - mb as i64).unsigned_abs())
        .expect("há opções")
}

/// Sugestão para o PC: deixa folga para o Windows, Steam e o próprio launcher.
pub fn recommended_mb(total_ram_mb: u64) -> u32 {
    match total_ram_mb {
        0 => MAX_MB,
        t if t <= 4096 => MIN_MB,
        t if t <= 6144 => 3072,
        _ => MAX_MB,
    }
}

/// Precisa da flag de 4 GB para esse teto?
pub fn needs_large_address(limit_mb: u32) -> bool {
    limit_mb > MIN_MB
}

/// Precisa de um teto aplicado em tempo de execução (entre 2 e 4 GB)?
pub fn needs_job_limit(limit_mb: u32) -> bool {
    limit_mb > MIN_MB && limit_mb < MAX_MB
}

/// Coloca o processo do jogo (já aberto) num Job Object com teto de memória.
/// Devolve o PID limitado.
#[cfg(windows)]
pub fn limit_running_game(limit_mb: u32) -> crate::Result<u32> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    let sys = System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()));
    let pid = sys
        .processes()
        .iter()
        .find(|(_, p)| p.name().to_string_lossy().eq_ignore_ascii_case(crate::game::EXE_NAME))
        .map(|(pid, _)| pid.as_u32())
        .ok_or_else(|| crate::Error::Other("o jogo não está aberto".into()))?;
    // SAFETY: chamadas Win32 com handles verificados; todos os handles são fechados no fim.
    unsafe {
        let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if proc.is_null() {
            return Err(crate::Error::Other("sem permissão para limitar a memória do jogo".into()));
        }
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            CloseHandle(proc);
            return Err(crate::Error::Other("o Windows não criou o limite de memória".into()));
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        info.ProcessMemoryLimit = limit_mb as usize * 1_048_576;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) != 0
            && AssignProcessToJobObject(job, proc) != 0;
        // o job continua valendo enquanto o processo existir, mesmo com o handle fechado
        CloseHandle(job);
        CloseHandle(proc);
        if !ok {
            return Err(crate::Error::Other("o Windows recusou o limite de memória para o jogo".into()));
        }
    }
    Ok(pid)
}

#[cfg(not(windows))]
pub fn limit_running_game(_limit_mb: u32) -> crate::Result<u32> {
    Err(crate::Error::Other("o limite de memória só existe no Windows".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_and_recommendation() {
        assert_eq!(normalize_mb(3000), 3072);
        assert_eq!(normalize_mb(100), 2048);
        assert_eq!(normalize_mb(64_000), 4096);
        assert_eq!(recommended_mb(4096), 2048);
        assert_eq!(recommended_mb(6000), 3072);
        assert_eq!(recommended_mb(16_384), 4096);
        assert!(!needs_large_address(2048) && needs_large_address(2560));
        assert!(needs_job_limit(3072) && !needs_job_limit(4096) && !needs_job_limit(2048));
        let m = system_memory();
        assert!(m.total_mb > 0 && m.available_mb <= m.total_mb);
    }
}
