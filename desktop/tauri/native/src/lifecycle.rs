#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    None,
    Choose,
    Prepare(u64),
    Hide,
    Exit,
}

#[derive(Default)]
pub struct Lifecycle {
    pub ready: bool,
    pub choice: bool,
    pub manual_prompt: bool,
    pub pending: Option<u64>,
    pub quitting: bool,
    sequence: u64,
}

impl Lifecycle {
    pub fn request(&mut self, preference: &str) -> Action {
        if self.quitting {
            return Action::Exit;
        }
        if self.choice || self.pending.is_some() || self.manual_prompt {
            return Action::None;
        }
        if !self.ready {
            self.quitting = true;
            return Action::Exit;
        }
        match preference {
            "quit" => self.prepare(),
            "background" => Action::Hide,
            _ => {
                self.choice = true;
                Action::Choose
            }
        }
    }
    pub fn decide(&mut self, decision: &str) -> Action {
        if !self.choice {
            return Action::None;
        }
        self.choice = false;
        match decision {
            "quit" => self.prepare(),
            "background" => Action::Hide,
            _ => Action::None,
        }
    }
    pub fn prepare(&mut self) -> Action {
        if self.pending.is_some() || self.manual_prompt {
            return Action::None;
        }
        self.sequence += 1;
        self.pending = Some(self.sequence);
        Action::Prepare(self.sequence)
    }
    pub fn acknowledge(&mut self, request: u64, saved: bool) -> Action {
        if self.pending != Some(request) {
            return Action::None;
        }
        self.pending = None;
        if saved {
            self.quitting = true;
            Action::Exit
        } else {
            Action::None
        }
    }
    pub fn timeout(&mut self, request: u64) -> bool {
        if self.pending == Some(request) && !self.manual_prompt {
            self.pending = None;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready() -> Lifecycle {
        Lifecycle {
            ready: true,
            ..Default::default()
        }
    }
    #[test]
    fn cancel_does_not_close() {
        let mut s = ready();
        assert_eq!(s.request("ask"), Action::Choose);
        assert_eq!(s.decide("cancel"), Action::None);
        assert!(!s.quitting);
        assert_eq!(s.request("ask"), Action::Choose);
    }
    #[test]
    fn quit_requires_current_save_ack() {
        let mut s = ready();
        assert_eq!(s.request("quit"), Action::Prepare(1));
        assert_eq!(s.acknowledge(9, true), Action::None);
        assert!(!s.quitting);
        assert_eq!(s.acknowledge(1, false), Action::None);
        assert_eq!(s.request("quit"), Action::Prepare(2));
        assert_eq!(s.acknowledge(1, true), Action::None);
        assert_eq!(s.acknowledge(2, true), Action::Exit);
    }
    #[test]
    fn duplicate_close_and_manual_prompt_are_blocked() {
        let mut s = ready();
        assert_eq!(s.request("quit"), Action::Prepare(1));
        assert_eq!(s.request("quit"), Action::None);
        s.manual_prompt = true;
        assert!(!s.timeout(1));
        s.manual_prompt = false;
        assert!(s.timeout(1));
        assert_eq!(s.acknowledge(1, true), Action::None);
    }
    #[test]
    fn background_never_quits() {
        let mut s = ready();
        assert_eq!(s.request("ask"), Action::Choose);
        assert_eq!(s.decide("background"), Action::Hide);
        assert!(!s.quitting);
        assert_eq!(s.pending, None);
    }
}
