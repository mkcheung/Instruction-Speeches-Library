<?php

class UserRole extends DatabaseObject{
	protected static $tablename = "user_roles";
	protected static $attributes = array('id', 'role');

	public $id;
	public $role;

	public function newUserRole($role){
		global $db;

		$Object = new static;
		$Object->role = $role;

		return $Object; 
	}

}

?>