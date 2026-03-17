# Homebrew formula for AgentXchain CLI
# Tap: brew tap shivamtiwari93/agentxchain
# Install: brew install agentxchain

class Agentxchain < Formula
  desc "CLI for multi-agent coordination in your IDE"
  homepage "https://agentxchain.dev"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/shivamtiwari93/agentXchain.dev/releases/download/v0.1.0/agentxchain-0.1.0-macos-arm64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end
    on_intel do
      url "https://github.com/shivamtiwari93/agentXchain.dev/releases/download/v0.1.0/agentxchain-0.1.0-macos-x64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/shivamtiwari93/agentXchain.dev/releases/download/v0.1.0/agentxchain-0.1.0-linux-x64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256"
    end
  end

  def install
    if OS.mac? && Hardware::CPU.arm?
      bin.install "agentxchain-macos-arm64" => "agentxchain"
    elsif OS.mac? && Hardware::CPU.intel?
      bin.install "agentxchain-macos-x64" => "agentxchain"
    elsif OS.linux? && Hardware::CPU.intel?
      bin.install "agentxchain-linux-x64" => "agentxchain"
    end
  end

  test do
    system "#{bin}/agentxchain", "--version"
  end
end
