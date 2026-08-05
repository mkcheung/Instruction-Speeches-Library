<?php
require_once("constants.php");
require_once("database.php");
require_once("DatabaseObject.php");
require_once("user.php");
require_once("function.php");

class Session{

	public $message ;
	public $fullName ;
	public $loggedIn = false;
	public $userId ;
	public $email ;
	public $userRoleId ; 

	public function __construct(){
		session_start();
		$this->checkIfLoggedIn();
	}

	public function checkIfLoggedIn(){
		if(isset($_SESSION['user_id'])){
			$this->userId = $_SESSION['user_id'] ; 
			$this->userRoleId = $_SESSION['user_role_id'];
			$this->fullName = $_SESSION['fullName'];
			$this->email = $_SESSION['email'];
			if(isset($_SESSION['message'])){
				$this->message = $_SESSION['message'];
			}
			
			$this->loggedIn = true;
		} else {
			$this->loggedIn = false;
		}
	}

	public function login($user){
		if(isset($user)){
			$_SESSION['user_id'] = $user->id;
			$_SESSION['full_name'] = $user->fullname;
			$_SESSION['email'] = $user->email;
			$_SESSION['user_role_id'] = $user->user_role_id;
			$this->loggedIn = true;
			return true;
		} else {
			return false;
		}
	}

	public function logout(){
		unset($_SESSION['user_id']);
		unset($_SESSION['fullName']);
		unset($_SESSION['message']);
		unset($_SESSION['user_role_id']);
		unset($this->userId);
		unset($this->fullName);
		unset($this->message);
		unset($this->userRoleId);
		session_destroy();
	}

	public function set_message($incomingMessage){
		$_SESSION['message'] = $incomingMessage;
		$this->message = $incomingMessage;
	}

	public function clear_message(){
		unset($_SESSION['message']);
		unset($this->message);
	}

	public function show_message(){
		echo '<p>' . $_SESSION['message'] . '</p>' ;
	}
}

$SESS = new Session();
?>