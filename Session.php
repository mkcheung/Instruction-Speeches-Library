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
	public function __construct(){
		session_start();
		$this->checkIfLoggedIn();
	}

	public function checkIfLoggedIn(){

		if(isset($_SESSION['user_id'])){
			$userId = $_SESSION['user_id'] ; 
			$fullName = $_SESSION['fullName'];
			$email = $_SESSION['email'];
			
			if(isset($_SESSION['message'])){
				$message = $_SESSION['message'];
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
		unset($this->userId);
		unset($this->fullName);
		unset($this->message);
		session_destroy();
	}

	public function set_message($message){
		$_SESSION['message'] = $message;
	}

	public function show_message(){
		echo '<p>' . $_SESSION['message'] . '</p>' ;
	}

	public function clear_message(){
		unset($_SESSION['message']);
		unset($this->message);
	}

}

$SESS = new Session();
?>